#!/usr/bin/env bash
# docker-build-test.sh — build each image and smoke-run it.
#
# Catches the failure mode that `pnpm test` cannot: a file missing from the build
# context. `.dockerignore` is an allowlist, so anything newly required by an image
# is absent until explicitly re-included — and a runtime-only read (a config file,
# a template) still builds green and fails in production.
#
# Each image is built, then run with no network and no configuration. The app is
# expected to fail fast on config validation; what is asserted is that it got that
# far without a missing-module error, which proves the module graph and every file
# it needs actually made it into the image.
#
# Everything runs inside BuildKit (`docker buildx bake`, docker/build-test/): the
# smoke runs are a RUN step on top of each image, not `docker run`, so no Docker
# engine is needed — any buildx builder works (Docker Desktop's default one locally,
# the remote BuildKit server in CI). Nothing is loaded into an image store.
#
# Usage:
#   scripts/docker-build-test.sh            # all images (default)
#   scripts/docker-build-test.sh prod       # docker/Dockerfile
#   scripts/docker-build-test.sh local      # docker/Dockerfile.local
#   scripts/docker-build-test.sh backend    # telemetry-backend/Dockerfile
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

# Every version comes from versions.env (the single source of truth) and is passed
# to the Dockerfiles as build-args of the same names (docker/build-test/docker-bake.hcl
# reads them from this environment).
set -a
# shellcheck source=/dev/null
. ./versions.env
set +a
: "${NODE_VERSION:?versions.env has no NODE_VERSION}" "${ALPINE_VERSION:?versions.env has no ALPINE_VERSION}" \
  "${NODE_DHI_DIGEST:?versions.env has no NODE_DHI_DIGEST}" "${NODE_DHI_DEV_DIGEST:?versions.env has no NODE_DHI_DEV_DIGEST}" \
  "${NODE_STOCK_DIGEST:?versions.env has no NODE_STOCK_DIGEST}" \
  "${COREPACK_VERSION:?versions.env has no COREPACK_VERSION}"
ALPINE="${ALPINE_VERSION}"
DHI_BASE="dhi.io/node:${NODE_VERSION}-alpine${ALPINE}@${NODE_DHI_DIGEST}"
STOCK_BASE="node:${NODE_VERSION}-alpine${ALPINE}@${NODE_STOCK_DIGEST}"
BAKE_FILE="docker/build-test/docker-bake.hcl"
# Gitignored scratch dir under the repo (bake writes local outputs there without an
# fs entitlement): the smoke results and the stock-base rewrite of the prod Dockerfile.
WORK_DIR=".docker-build-test"
# Per-run id: part of the smoke step's cache key, and checked in its result, so a
# cached (or leftover) result can never pass for this run's.
RUN_ID="$(date +%s)-$$-${RANDOM}${RANDOM}"
FAILED=0
TMP_DOCKER_CONFIG=""
OUT=""
SPEC=""
DEFAULT_CMD=()

cleanup() {
  rm -rf "${REPO_ROOT:?}/${WORK_DIR}"
  # Holds a registry login in plain form — never leave it behind.
  if [[ -n "${TMP_DOCKER_CONFIG}" ]]; then rm -rf "${TMP_DOCKER_CONFIG}"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Missing files surface as these; anything else (config validation) is expected.
MODULE_ERRORS='Cannot find module|ERR_MODULE_NOT_FOUND|Cannot find package|MODULE_NOT_FOUND|no such file or directory'

# check <name> <env> <command> [args...] — add one check to SPEC, the input of
# docker/build-test/smoke.mjs: <env> is `-` or comma-separated KEY=VALUE pairs; the
# fields are TAB-joined, one check per line.
check() {
  local IFS=$'\t'
  SPEC+="$*"$'\n'
}

# load_default_cmd <dockerfile> — set DEFAULT_CMD to the image's default command (its
# last CMD). The smoke step runs it as-is: it does not see the image config, so it
# cannot apply an ENTRYPOINT — a Dockerfile that sets one fails here instead of being
# tested wrongly.
load_default_cmd() {
  local dockerfile="$1" line word re='^CMD \[("[^"\\]*"(, *)?)+\]$'
  DEFAULT_CMD=()
  if grep -qE '^ENTRYPOINT' "${dockerfile}"; then
    echo "  FAIL: ${dockerfile} sets an ENTRYPOINT, which the smoke step cannot apply — extend scripts/docker-build-test.sh."
    return 1
  fi
  line="$(grep -E '^CMD ' "${dockerfile}" | tail -1 || true)"
  if [[ ! "${line}" =~ ${re} ]]; then
    echo "  FAIL: ${dockerfile}: the last CMD is not a plain exec-form JSON array: ${line:-<none>}"
    return 1
  fi
  while IFS= read -r word; do DEFAULT_CMD+=("${word}"); done < <(grep -oE '"[^"]*"' <<<"${line#CMD }" | tr -d '"')
}

# bake_smoke <image> — build the image and run SPEC on it (bake target smoke-<image>).
# Sets OUT to the result dir; returns 1 (and marks the run failed) when the build fails
# or its result is not this run's.
bake_smoke() {
  local image="$1" log="/tmp/e2m-bt-$1.log" got
  OUT="${WORK_DIR}/out/${image}"
  rm -rf "${OUT}"
  if ! SMOKE_SPEC="${SPEC}" SMOKE_RUN_ID="${RUN_ID}" SMOKE_OUT="${OUT}" \
    docker buildx bake -f "${BAKE_FILE}" --progress plain "smoke-${image}" >"${log}" 2>&1; then
    echo "  FAIL: build failed"; tail -15 "${log}" | sed 's/^/    /'; FAILED=1; return 1
  fi
  got="$(cat "${OUT}/run-id" 2>/dev/null || true)"
  if [[ "${got}" != "${RUN_ID}" ]]; then
    echo "  FAIL: the smoke step did not run in this build (result run id '${got}', expected '${RUN_ID}')."
    echo "    A cached or stale result is never accepted — see docker/build-test/smoke.Dockerfile."
    FAILED=1; return 1
  fi
}

# smoke <check-name> <expected-startup-marker>
# Asserts that the check reached the marker with no module errors.
smoke() {
  local name="$1" marker="$2" out
  # The app exits non-zero on missing config — that is the success path here, so the
  # exit status is not asserted, only the output.
  out="$(cat "${OUT}/${name}.log" 2>/dev/null || true)"

  if grep -qE "${MODULE_ERRORS}" <<<"${out}"; then
    echo "  FAIL: image is missing files needed at runtime:"
    grep -E "${MODULE_ERRORS}" <<<"${out}" | head -3 | sed 's/^/    /'
    echo "    -> add the missing path to .dockerignore as an explicit !entry"
    FAILED=1
    return
  fi

  if ! grep -qF "${marker}" <<<"${out}"; then
    echo "  FAIL: image did not reach its expected startup point."
    echo "    expected to see: ${marker}"
    echo "    exit status: $(cat "${OUT}/${name}.status" 2>/dev/null || echo unknown)"
    echo "    actual output:"
    head -10 <<<"${out}" | sed 's/^/    /'
    FAILED=1
    return
  fi

  echo "  OK: builds, starts, and reaches config validation with no missing modules"
}

dhi_reachable() {
  docker buildx imagetools inspect "${DHI_BASE}" >/dev/null 2>&1
}

# Maintainer fallback: log in to dhi.io the way CI does (the pull-only token from
# fnox profile `read`), into a throwaway file-based Docker config. The user's own
# config is not used for the login: Docker Desktop's credential store can report
# "Login Succeeded" and still not hand the dhi.io credential back. The current
# context, buildx builders and CLI plugins are linked in so builds run unchanged.
# Exports DOCKER_CONFIG for the rest of the script on success.
dhi_login_via_fnox() {
  command -v fnox >/dev/null 2>&1 || return 1
  local src="${DOCKER_CONFIG:-${HOME}/.docker}" context entry
  context="$(docker context show 2>/dev/null || echo default)"
  TMP_DOCKER_CONFIG="$(mktemp -d)"
  for entry in contexts buildx cli-plugins; do
    if [[ -e "${src}/${entry}" ]]; then ln -s "${src}/${entry}" "${TMP_DOCKER_CONFIG}/${entry}"; fi
  done
  # The `auths` entry matters: a config without one makes the CLI silently adopt the
  # platform credential helper (Docker Desktop's store again), not this file.
  printf '{"currentContext":"%s","auths":{"dhi.io":{}}}\n' "${context}" >"${TMP_DOCKER_CONFIG}/config.json"
  # shellcheck disable=SC2016 # expanded by the inner sh, inside fnox's environment
  if ! DOCKER_CONFIG="${TMP_DOCKER_CONFIG}" fnox exec --no-defaults -P read -- \
    sh -c 'printf %s "${DOCKERHUB_PASSWORD_READ}" | docker login -u "${DOCKERHUB_USERNAME}" --password-stdin dhi.io' \
    >/dev/null 2>&1; then
    return 1
  fi
  export DOCKER_CONFIG="${TMP_DOCKER_CONFIG}"
}

# The two HEALTHCHECK commands published images ran that import app code (the other
# historical forms read /tmp/e2m-health directly). Health checks are ENABLED and a fresh
# health file is written first, so each command must import ./dist/health.js and report
# healthy (exit 0); a missing module lands in the command's catch and exits 1.
LEGACY_HEALTH_ENV='MQTT_URL=mqtt://127.0.0.1:1,MQTT_USERNAME=u,MQTT_PASSWORD=p,ELECTROLUX_API_KEY=k,ELECTROLUX_USERNAME=e,ELECTROLUX_PASSWORD=p,ELECTROLUX_COUNTRY_CODE=FI,HEALTH_CHECK_ENABLED=true'
LEGACY_HEALTH_FRESH="require('fs').writeFileSync('/tmp/e2m-health',String(Math.floor(Date.now()/1000)));"
LEGACY_HEALTHCHECKS=(
  "if(process.env.HEALTH_CHECK_ENABLED!=='true')process.exit(0);import('./dist/health.js').then(m=>{process.exit(m.isHealthy(60)?0:1)}).catch(()=>process.exit(1))"
  "import('./dist/health.js').then(m=>{if(!m.healthCheckEnabled)process.exit(0);process.exit(m.isHealthy(60)?0:1)}).catch(()=>process.exit(1))"
)

legacy_healthchecks() {
  local i status
  for i in "${!LEGACY_HEALTHCHECKS[@]}"; do
    status="$(cat "${OUT}/legacy-health-${i}.status" 2>/dev/null || echo missing)"
    if [[ "${status}" != "0" ]]; then
      echo "  FAIL: a legacy HEALTHCHECK command exits ${status} (expected 0 with a fresh health file):"
      echo "    ${LEGACY_HEALTHCHECKS[${i}]}"
      FAILED=1
      return
    fi
  done
  echo "  OK: legacy HEALTHCHECK commands (./dist/health.js) still pass"
}

build_prod() {
  echo "== prod image (docker/Dockerfile) =="
  local dockerfile="docker/Dockerfile" i

  # The hardened dhi.io base needs a Docker login (CI logs in; a maintainer's
  # machine logs in through fnox, above). Without one, rather than skip the most
  # important image, the FROM lines are rewritten to stock node images so the
  # COPY/install/build logic is still exercised. The substitution is announced —
  # it is not a full check.
  if dhi_reachable; then
    :
  elif dhi_login_via_fnox && dhi_reachable; then
    echo "  NOTE: logged in to dhi.io with fnox profile \`read\` (temporary Docker config)."
  else
    echo "  NOTE: no access to dhi.io (not logged in, no fnox \`read\` access) — substituting stock ${STOCK_BASE}."
    echo "        Context/COPY/build logic is still verified; the hardened base is not."
    mkdir -p "${WORK_DIR}"
    sed -E "s|^FROM \\\$\{NODE_(DEV_)?IMAGE\}|FROM ${STOCK_BASE}|" \
      "${dockerfile}" > "${WORK_DIR}/prod.Dockerfile"
    dockerfile="${WORK_DIR}/prod.Dockerfile"
  fi
  # The version build-args are required by the Dockerfile (no defaults); in the
  # substituted stock-image path the dhi.io ones are simply unused.
  export PROD_DOCKERFILE="${dockerfile}"

  load_default_cmd "${dockerfile}" || { FAILED=1; return; }
  SPEC=""
  check default - "${DEFAULT_CMD[@]}"
  # Containers recreated by Portainer/Watchtower-style updaters keep the OLD container's
  # Cmd and Healthcheck (docker/compat/legacy-dist/index.js) — every one a published image
  # ever had must keep working on this image.
  check legacy-entry - node dist/index.js
  for i in "${!LEGACY_HEALTHCHECKS[@]}"; do
    check "legacy-health-${i}" "${LEGACY_HEALTH_ENV}" node -e "${LEGACY_HEALTH_FRESH}${LEGACY_HEALTHCHECKS[${i}]}"
  done

  bake_smoke prod || return 0
  smoke default "Environment variable validation failed"
  echo "  legacy entry (node dist/index.js):"
  smoke legacy-entry "Environment variable validation failed"
  legacy_healthchecks
}

build_local() {
  echo "== local dev image (docker/Dockerfile.local) =="
  SPEC=""
  # CMD is `pnpm dev` (node --watch), which never exits — run the entrypoint once instead.
  check entry - node src/index.ts
  bake_smoke local || return 0
  smoke entry "Environment variable validation failed"
}

build_backend() {
  echo "== telemetry-backend image (telemetry-backend/Dockerfile) =="
  load_default_cmd telemetry-backend/Dockerfile || { FAILED=1; return; }
  SPEC=""
  check default - "${DEFAULT_CMD[@]}"
  bake_smoke backend || return 0
  smoke default "CLICKHOUSE_URL is required"
}

case "${1:-all}" in
  prod | local | backend | all) ;;
  -h | --help) sed -n '2,23p' "$0"; exit 0 ;;
  *) echo "Usage: $0 [prod|local|backend|all]" >&2; exit 1 ;;
esac

# Any buildx builder will do: the current one (`docker buildx use`, or BUILDX_BUILDER).
if ! docker buildx inspect --bootstrap >/dev/null 2>&1; then
  echo "ERROR: no usable buildx builder — start Docker, or select a reachable one (docker buildx use <name>)." >&2
  exit 1
fi
echo "Builder: $(docker buildx inspect | sed -n 's/^Name: *//p; s/^Driver: *//p' | head -2 | tr '\n' ' ')"

case "${1:-all}" in
  prod)    build_prod ;;
  local)   build_local ;;
  backend) build_backend ;;
  all)     build_prod; build_local; build_backend ;;
esac

if [[ "${FAILED}" -ne 0 ]]; then
  echo
  echo "Docker build test FAILED — an image is missing files or does not start."
  exit 1
fi
echo
echo "Docker build test passed."

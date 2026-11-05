#!/usr/bin/env bash
# docker-build-test.sh — build each image and smoke-run it.
#
# Catches the failure mode that `pnpm test` cannot: a file missing from the build
# context. `.dockerignore` is an allowlist, so anything newly required by an image
# is absent until explicitly re-included — and a runtime-only read (a config file,
# a template) still builds green and fails in production.
#
# Each image is built, then run with `--network none` and no configuration. The
# app is expected to fail fast on config validation; what is asserted is that it
# got that far without a missing-module error, which proves the module graph and
# every file it needs actually made it into the image.
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
# to the Dockerfiles as build-args of the same names.
set -a
# shellcheck source=/dev/null
. ./versions.env
set +a
: "${NODE_MAJOR:?versions.env has no NODE_MAJOR}" "${ALPINE_VERSION:?versions.env has no ALPINE_VERSION}" \
  "${COREPACK_VERSION:?versions.env has no COREPACK_VERSION}"
ALPINE="${ALPINE_VERSION}"
VERSION_ARGS=(--build-arg NODE_MAJOR --build-arg ALPINE_VERSION --build-arg COREPACK_VERSION)
TAG_PREFIX="e2m-buildtest"
DHI_BASE="dhi.io/node:${NODE_MAJOR}-alpine${ALPINE}"
FAILED=0
BUILT_TAGS=()
TMP_DOCKER_CONFIG=""

cleanup() {
  if [[ ${#BUILT_TAGS[@]} -gt 0 ]]; then
    docker rmi -f "${BUILT_TAGS[@]}" >/dev/null 2>&1 || true
  fi
  rm -f "${REPO_ROOT}/.docker-build-test.Dockerfile"
  # Holds a registry login in plain form — never leave it behind.
  if [[ -n "${TMP_DOCKER_CONFIG}" ]]; then rm -rf "${TMP_DOCKER_CONFIG}"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Missing files surface as these; anything else (config validation) is expected.
MODULE_ERRORS='Cannot find module|ERR_MODULE_NOT_FOUND|Cannot find package|MODULE_NOT_FOUND|no such file or directory'

# smoke <tag> <expected-startup-marker> [command-override...]
# Runs the image offline and asserts it reached the marker with no module errors.
smoke() {
  local tag="$1" marker="$2"
  shift 2
  local out
  # The app exits non-zero on missing config — that is the success path here, so
  # the run itself must not abort the script.
  out="$(docker run --rm --network none "$tag" "$@" 2>&1 || true)"

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
    echo "    actual output:"
    head -10 <<<"${out}" | sed 's/^/    /'
    FAILED=1
    return
  fi

  echo "  OK: builds, starts, and reaches config validation with no missing modules"
}

dhi_reachable() {
  docker manifest inspect "${DHI_BASE}" >/dev/null 2>&1
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

build_prod() {
  echo "== prod image (docker/Dockerfile) =="
  local tag="${TAG_PREFIX}-prod" dockerfile="docker/Dockerfile"

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
    echo "  NOTE: no access to dhi.io (not logged in, no fnox \`read\` access) — substituting stock node:${NODE_MAJOR}-alpine${ALPINE}."
    echo "        Context/COPY/build logic is still verified; the hardened base is not."
    sed -E "s|^FROM \\\$\{NODE_IMAGE\}-dev|FROM node:${NODE_MAJOR}-alpine${ALPINE}|; s|^FROM \\\$\{NODE_IMAGE\}|FROM node:${NODE_MAJOR}-alpine${ALPINE}|" \
      "${dockerfile}" > .docker-build-test.Dockerfile
    dockerfile=".docker-build-test.Dockerfile"
  fi

  # The version build-args are required by the Dockerfile (no defaults); in the
  # substituted stock-image path NODE_MAJOR/ALPINE_VERSION are simply unused.
  if ! docker build --network host -f "${dockerfile}" \
    "${VERSION_ARGS[@]}" -t "${tag}" . >/tmp/e2m-bt-prod.log 2>&1; then
    echo "  FAIL: build failed"; tail -15 /tmp/e2m-bt-prod.log | sed 's/^/    /'; FAILED=1; return
  fi
  BUILT_TAGS+=("${tag}")
  smoke "${tag}" "Environment variable validation failed"
  # Containers recreated by Portainer/Watchtower-style updaters keep the OLD container's
  # Cmd and Healthcheck (docker/compat/legacy-dist/index.js) — every one a published image
  # ever had must keep working on this image.
  echo "  legacy entry (node dist/index.js):"
  smoke "${tag}" "Environment variable validation failed" node dist/index.js
  legacy_healthchecks "${tag}"
}

# The two HEALTHCHECK commands published images ran that import app code (the other
# historical forms read /tmp/e2m-health directly). Health checks are ENABLED and a fresh
# health file is written first, so each command must import ./dist/health.js and report
# healthy (exit 0); a missing module lands in the command's catch and exits 1.
legacy_healthchecks() {
  local tag="$1" cmd status
  local -a env_args=(-e MQTT_URL=mqtt://127.0.0.1:1 -e MQTT_USERNAME=u -e MQTT_PASSWORD=p
    -e ELECTROLUX_API_KEY=k -e ELECTROLUX_USERNAME=e -e ELECTROLUX_PASSWORD=p
    -e ELECTROLUX_COUNTRY_CODE=FI -e HEALTH_CHECK_ENABLED=true)
  local fresh="require('fs').writeFileSync('/tmp/e2m-health',String(Math.floor(Date.now()/1000)));"
  local -a commands=(
    "if(process.env.HEALTH_CHECK_ENABLED!=='true')process.exit(0);import('./dist/health.js').then(m=>{process.exit(m.isHealthy(60)?0:1)}).catch(()=>process.exit(1))"
    "import('./dist/health.js').then(m=>{if(!m.healthCheckEnabled)process.exit(0);process.exit(m.isHealthy(60)?0:1)}).catch(()=>process.exit(1))"
  )
  for cmd in "${commands[@]}"; do
    status=0
    docker run --rm --network none "${env_args[@]}" "${tag}" node -e "${fresh}${cmd}" >/dev/null 2>&1 || status=$?
    if [[ "${status}" -ne 0 ]]; then
      echo "  FAIL: a legacy HEALTHCHECK command exits ${status} (expected 0 with a fresh health file):"
      echo "    ${cmd}"
      FAILED=1
      return
    fi
  done
  echo "  OK: legacy HEALTHCHECK commands (./dist/health.js) still pass"
}

build_local() {
  echo "== local dev image (docker/Dockerfile.local) =="
  local tag="${TAG_PREFIX}-local"
  if ! docker build --network host -f docker/Dockerfile.local \
    "${VERSION_ARGS[@]}" -t "${tag}" . >/tmp/e2m-bt-local.log 2>&1; then
    echo "  FAIL: build failed"; tail -15 /tmp/e2m-bt-local.log | sed 's/^/    /'; FAILED=1; return
  fi
  BUILT_TAGS+=("${tag}")
  # CMD is `pnpm dev` (node --watch), which never exits — run the entrypoint once instead.
  smoke "${tag}" "Environment variable validation failed" node src/index.ts
}

build_backend() {
  echo "== telemetry-backend image (telemetry-backend/Dockerfile) =="
  local tag="${TAG_PREFIX}-backend"
  if ! docker build --network host -f telemetry-backend/Dockerfile \
    "${VERSION_ARGS[@]}" -t "${tag}" . >/tmp/e2m-bt-backend.log 2>&1; then
    echo "  FAIL: build failed"; tail -15 /tmp/e2m-bt-backend.log | sed 's/^/    /'; FAILED=1; return
  fi
  BUILT_TAGS+=("${tag}")
  smoke "${tag}" "CLICKHOUSE_URL is required"
}

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker is not running." >&2
  exit 1
fi

case "${1:-all}" in
  prod)    build_prod ;;
  local)   build_local ;;
  backend) build_backend ;;
  all)     build_prod; build_local; build_backend ;;
  -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
  *) echo "Usage: $0 [prod|local|backend|all]" >&2; exit 1 ;;
esac

if [[ "${FAILED}" -ne 0 ]]; then
  echo
  echo "Docker build test FAILED — an image is missing files or does not start."
  exit 1
fi
echo
echo "Docker build test passed."

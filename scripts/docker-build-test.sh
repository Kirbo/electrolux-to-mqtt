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

NODE_MAJOR="$(cat .nvmrc)"
TAG_PREFIX="e2m-buildtest"
FAILED=0
BUILT_TAGS=()

cleanup() {
  if [[ ${#BUILT_TAGS[@]} -gt 0 ]]; then
    docker rmi -f "${BUILT_TAGS[@]}" >/dev/null 2>&1 || true
  fi
  rm -f "${REPO_ROOT}/.docker-build-test.Dockerfile"
}
trap cleanup EXIT

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

build_prod() {
  echo "== prod image (docker/Dockerfile) =="
  local tag="${TAG_PREFIX}-prod" dockerfile="docker/Dockerfile"

  # The hardened dhi.io base needs a Docker Hardened Images entitlement. CI has it;
  # most developer machines do not. Rather than skip the most important image, the
  # FROM lines are rewritten to stock node images so the COPY/install/build logic
  # is still exercised. The substitution is announced — it is not a full check.
  if ! docker manifest inspect "dhi.io/node:${NODE_MAJOR}-alpine$(grep -oE '[0-9]+\.[0-9]+' <<<"$(grep ALPINE_VERSION mise.toml)")" >/dev/null 2>&1; then
    echo "  NOTE: dhi.io unreachable (no entitlement) — substituting stock node:${NODE_MAJOR}-alpine."
    echo "        Context/COPY/build logic is still verified; the hardened base is not."
    sed -E "s|^FROM \\\$\{NODE_IMAGE\}-dev|FROM node:${NODE_MAJOR}-alpine|; s|^FROM \\\$\{NODE_IMAGE\}|FROM node:${NODE_MAJOR}-alpine|" \
      "${dockerfile}" > .docker-build-test.Dockerfile
    dockerfile=".docker-build-test.Dockerfile"
  fi

  if ! docker build --network host -f "${dockerfile}" -t "${tag}" . >/tmp/e2m-bt-prod.log 2>&1; then
    echo "  FAIL: build failed"; tail -15 /tmp/e2m-bt-prod.log | sed 's/^/    /'; FAILED=1; return
  fi
  BUILT_TAGS+=("${tag}")
  smoke "${tag}" "Environment variable validation failed"
}

build_local() {
  echo "== local dev image (docker/Dockerfile.local) =="
  local tag="${TAG_PREFIX}-local"
  if ! docker build --network host -f docker/Dockerfile.local \
    --build-arg "NODE_VERSION=${NODE_MAJOR}" -t "${tag}" . >/tmp/e2m-bt-local.log 2>&1; then
    echo "  FAIL: build failed"; tail -15 /tmp/e2m-bt-local.log | sed 's/^/    /'; FAILED=1; return
  fi
  BUILT_TAGS+=("${tag}")
  # CMD is `pnpm dev` (tsx watch), which never exits — run the entrypoint once instead.
  smoke "${tag}" "Environment variable validation failed" sh -c 'pnpm exec tsx src/index.ts'
}

build_backend() {
  echo "== telemetry-backend image (telemetry-backend/Dockerfile) =="
  local tag="${TAG_PREFIX}-backend"
  if ! docker build --network host -f telemetry-backend/Dockerfile \
    --build-arg "NODE_VERSION=${NODE_MAJOR}" -t "${tag}" . >/tmp/e2m-bt-backend.log 2>&1; then
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

#!/usr/bin/env bash
# sync-versions.sh — propagate node + Alpine versions from mise.toml to all derived files.
# Run after editing mise.toml [tools] node or [env] ALPINE_VERSION.
# Idempotent: running twice produces no diff.
#
# Usage:
#   bash scripts/sync-versions.sh          # from repo root
#   pnpm sync:versions                     # via pnpm script alias
#   mise run sync-versions                 # via mise task
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MISE_TOML="${REPO_ROOT}/mise.toml"

# ── Parse mise.toml (no TOML lib needed — simple grep/sed) ─────────────────

# node = "24"  →  24
NODE=$(grep -E '^node\s*=\s*"[0-9]+"' "${MISE_TOML}" | sed 's/.*"\([0-9]*\)".*/\1/')
# ALPINE_VERSION = "3.24"  →  3.24
ALPINE=$(grep -E '^ALPINE_VERSION\s*=\s*"[0-9]+\.[0-9]+"' "${MISE_TOML}" | sed 's/.*"\([0-9]*\.[0-9]*\)".*/\1/')

if [[ -z "${NODE}" ]]; then
  echo "ERROR: could not parse node version from ${MISE_TOML}" >&2
  exit 1
fi
if [[ -z "${ALPINE}" ]]; then
  echo "ERROR: could not parse ALPINE_VERSION from ${MISE_TOML}" >&2
  exit 1
fi

NODE_NEXT=$(( NODE + 1 ))

echo "Syncing: node=${NODE}  alpine=${ALPINE}"

# ── Helper: report only changed lines ────────────────────────────────────────

changed() {
  local file="$1"
  local before after
  before=$(cat "${file}")
  shift
  "$@"  # execute the actual sed/node command
  after=$(cat "${file}")
  if [[ "${before}" != "${after}" ]]; then
    echo "  updated: ${file}"
  fi
}

# ── 1. .nvmrc ─────────────────────────────────────────────────────────────────

changed "${REPO_ROOT}/.nvmrc" \
  bash -c "printf '%s\n' '${NODE}' > '${REPO_ROOT}/.nvmrc'"

# ── 2. root package.json engines.node ─────────────────────────────────────────

changed "${REPO_ROOT}/package.json" \
  node -e "
    const fs = require('fs');
    const path = '${REPO_ROOT}/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.engines = pkg.engines ?? {};
    pkg.engines.node = '>=${NODE}.0.0 <${NODE_NEXT}.0.0';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "

# ── 3. telemetry-backend/package.json engines.node ───────────────────────────

changed "${REPO_ROOT}/telemetry-backend/package.json" \
  node -e "
    const fs = require('fs');
    const path = '${REPO_ROOT}/telemetry-backend/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.engines = pkg.engines ?? {};
    pkg.engines.node = '>=${NODE}.0.0 <${NODE_NEXT}.0.0';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "

# ── 4. docker/Dockerfile  ARG NODE_VERSION=<node>-alpine<alpine> ─────────────

changed "${REPO_ROOT}/docker/Dockerfile" \
  sed -i.bak -E "s|^(ARG NODE_VERSION=)[0-9]+-alpine[0-9]+\.[0-9]+|\1${NODE}-alpine${ALPINE}|" \
    "${REPO_ROOT}/docker/Dockerfile"
rm -f "${REPO_ROOT}/docker/Dockerfile.bak"

# ── 5. docker/Dockerfile.local  ARG NODE_VERSION=<node> ─────────────────────

changed "${REPO_ROOT}/docker/Dockerfile.local" \
  sed -i.bak -E "s|^(ARG NODE_VERSION=)[0-9]+$|\1${NODE}|" \
    "${REPO_ROOT}/docker/Dockerfile.local"
rm -f "${REPO_ROOT}/docker/Dockerfile.local.bak"

# ── 6. docker/docker-compose.local.example.yml  NODE_VERSION:-<node> ─────────

changed "${REPO_ROOT}/docker/docker-compose.local.example.yml" \
  sed -i.bak -E "s|(NODE_VERSION:-)[0-9]+|\1${NODE}|" \
    "${REPO_ROOT}/docker/docker-compose.local.example.yml"
rm -f "${REPO_ROOT}/docker/docker-compose.local.example.yml.bak"

# ── 6b. docker/docker-compose.local.yml (gitignored, best-effort) ─────────────

if [[ -f "${REPO_ROOT}/docker/docker-compose.local.yml" ]]; then
  changed "${REPO_ROOT}/docker/docker-compose.local.yml" \
    sed -i.bak -E "s|(NODE_VERSION:-)[0-9]+|\1${NODE}|" \
      "${REPO_ROOT}/docker/docker-compose.local.yml"
  rm -f "${REPO_ROOT}/docker/docker-compose.local.yml.bak"
fi

# ── 7. telemetry-backend/Dockerfile  ARG NODE_VERSION=<node> ────────────────

changed "${REPO_ROOT}/telemetry-backend/Dockerfile" \
  sed -i.bak -E "s|^(ARG NODE_VERSION=)[0-9]+$|\1${NODE}|" \
    "${REPO_ROOT}/telemetry-backend/Dockerfile"
rm -f "${REPO_ROOT}/telemetry-backend/Dockerfile.bak"

# ── 8. telemetry-backend/docker-compose.yml  NODE_VERSION:-<node> ────────────

changed "${REPO_ROOT}/telemetry-backend/docker-compose.yml" \
  sed -i.bak -E "s|(NODE_VERSION:-)[0-9]+|\1${NODE}|" \
    "${REPO_ROOT}/telemetry-backend/docker-compose.yml"
rm -f "${REPO_ROOT}/telemetry-backend/docker-compose.yml.bak"

# ── 9. .gitlab/ci/01_init.yml  -alpine<alpine> literal ───────────────────────
# Matches: echo "NODE_VERSION=$(cat .nvmrc)-alpine3.24" >> variables.env
# The $(cat .nvmrc) part auto-follows .nvmrc; only the alpine literal is managed here.

changed "${REPO_ROOT}/.gitlab/ci/01_init.yml" \
  sed -i.bak -E "s|(echo \"NODE_VERSION=\\\$\(cat \.nvmrc\))-alpine[0-9]+\.[0-9]+|\1-alpine${ALPINE}|" \
    "${REPO_ROOT}/.gitlab/ci/01_init.yml"
rm -f "${REPO_ROOT}/.gitlab/ci/01_init.yml.bak"

echo "Done."

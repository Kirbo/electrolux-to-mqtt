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

# `|| true`: under pipefail a non-matching grep would abort the script before
# the friendly ERROR branches below can run.
# node = "24"  →  24
NODE=$(grep -E '^node\s*=\s*"[0-9]+"' "${MISE_TOML}" | sed 's/.*"\([0-9]*\)".*/\1/' || true)
# ALPINE_VERSION = "3.24"  →  3.24
ALPINE=$(grep -E '^ALPINE_VERSION\s*=\s*"[0-9]+\.[0-9]+"' "${MISE_TOML}" | sed 's/.*"\([0-9]*\.[0-9]*\)".*/\1/' || true)

if [[ -z "${NODE}" ]]; then
  echo "ERROR: could not parse node version from ${MISE_TOML}" >&2
  exit 1
fi
if [[ -z "${ALPINE}" ]]; then
  echo "ERROR: could not parse ALPINE_VERSION from ${MISE_TOML}" >&2
  exit 1
fi

NODE_NEXT=$(( NODE + 1 ))

# Captured before any rewrite so step 10 can tell whether the range actually moved
# and only then pay for a re-resolve.
TYPES_BEFORE=$(node -p "require('${REPO_ROOT}/package.json').devDependencies['@types/node'] ?? ''" 2>/dev/null || echo '')

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

# ── 2. root package.json — engines.node + devDependencies['@types/node'] ─────
#
# @types/node MUST track the Node major: `pnpm update --latest` otherwise drifts
# it to the newest release line (^25, ^26, …) while the runtime stays on ${NODE},
# so the type definitions describe APIs the runtime does not have.

changed "${REPO_ROOT}/package.json" \
  node -e "
    const fs = require('fs');
    const path = '${REPO_ROOT}/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.engines = pkg.engines ?? {};
    pkg.engines.node = '>=${NODE}.0.0 <${NODE_NEXT}.0.0';
    const typesNode = pkg.devDependencies?.['@types/node'];
    if (typesNode) {
      // Only correct the MAJOR. A more specific in-major floor (e.g. ^24.13.3)
      // is a deliberate choice and still resolves to the newest 24.x, so leave
      // it alone; rewriting it would flatten intent without preventing drift.
      const major = /^\D*(\d+)\./.exec(typesNode)?.[1];
      if (major !== '${NODE}') {
        pkg.devDependencies['@types/node'] = '^${NODE}.0.0';
      }
    }
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "

# ── 3. telemetry-backend/package.json — same two fields ──────────────────────

changed "${REPO_ROOT}/telemetry-backend/package.json" \
  node -e "
    const fs = require('fs');
    const path = '${REPO_ROOT}/telemetry-backend/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.engines = pkg.engines ?? {};
    pkg.engines.node = '>=${NODE}.0.0 <${NODE_NEXT}.0.0';
    const typesNode = pkg.devDependencies?.['@types/node'];
    if (typesNode) {
      // Only correct the MAJOR. A more specific in-major floor (e.g. ^24.13.3)
      // is a deliberate choice and still resolves to the newest 24.x, so leave
      // it alone; rewriting it would flatten intent without preventing drift.
      const major = /^\D*(\d+)\./.exec(typesNode)?.[1];
      if (major !== '${NODE}') {
        pkg.devDependencies['@types/node'] = '^${NODE}.0.0';
      }
    }
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

# ── 10. Re-resolve lockfiles if the @types/node range moved ──────────────────
# Rewriting the range in package.json does NOT re-resolve pnpm-lock.yaml, so the
# installed types would stay on the old major until someone installs. Both
# lockfiles are ignored by `pnpm update --latest` (updateConfig.ignoreDependencies
# in each pnpm-workspace.yaml), which makes this script the only thing that ever
# moves the range — so it also has to be what re-resolves it.
TYPES_AFTER=$(node -p "require('${REPO_ROOT}/package.json').devDependencies['@types/node'] ?? ''" 2>/dev/null || echo '')
if [[ "${TYPES_BEFORE}" != "${TYPES_AFTER}" ]]; then
  echo "  @types/node: ${TYPES_BEFORE:-<unset>} -> ${TYPES_AFTER}"
  # The CI "versions in sync" job runs this script on a bare alpine image with only
  # bash/git/nodejs installed — no pnpm. Check for it rather than letting the shell
  # emit "pnpm: command not found", which reads as a broken script when the real
  # failure is the drift that the git-diff gate is about to report.
  if command -v pnpm >/dev/null 2>&1; then
    echo "  re-resolving lockfiles..."
    (cd "${REPO_ROOT}" && pnpm install --silent) ||
      echo "  WARNING: root 'pnpm install' failed — run it manually so pnpm-lock.yaml re-resolves." >&2
    (cd "${REPO_ROOT}/telemetry-backend" && pnpm install --silent) ||
      echo "  WARNING: telemetry-backend 'pnpm install' failed — run it manually." >&2
  else
    echo "  pnpm not available — skipping lockfile re-resolve."
    echo "  Run 'pnpm install' in both packages so the lockfiles pick up the new range."
  fi
fi

echo "Done."

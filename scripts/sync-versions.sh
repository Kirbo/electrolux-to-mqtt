#!/usr/bin/env bash
# sync-versions.sh — derive every package.json version field from versions.env.
#
# Source of truth: versions.env (repo root). Derived (never hand-edit):
#   package.json + telemetry-backend/package.json
#     engines.node                  ">=<NODE_MAJOR>.0.0 <<NODE_MAJOR+1>.0.0"
#     devDependencies['@types/node'] major = NODE_MAJOR (an in-major floor is kept)
#   package.json only
#     packageManager                pnpm@<PNPM_VERSION>+sha512.… (via Corepack, which adds the hash)
#     alpineVersion                 <ALPINE_VERSION>
#     corepackVersion               <COREPACK_VERSION>
# These copies exist because package.json is the release-gated CI path (an image-
# affecting bump must cut a release) and because Corepack/engine-strict read
# package.json. Lockfiles are re-resolved when the @types/node range moves.
#
# Also validates versions.env: it is SOURCED as shell by CI, hooks and scripts, so
# only plain KEY=value lines are allowed.
#
# Idempotent. The CI job `versions in sync` runs it on a bare alpine image (bash,
# git, nodejs — no pnpm) and fails on any resulting `git diff`.
#
# Usage:
#   pnpm sync:versions | mise run sync-versions | bash scripts/sync-versions.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSIONS="${REPO_ROOT}/versions.env"
REQUIRED=(NODE_MAJOR ALPINE_VERSION COREPACK_VERSION PNPM_VERSION)

# ── 0. Validate + load versions.env ──────────────────────────────────────────
bad=$(grep -nvE '^([[:space:]]*(#.*)?|[A-Z][A-Z0-9_]*=[A-Za-z0-9._-]+)$' "${VERSIONS}" || true)
if [[ -n "${bad}" ]]; then
  echo "ERROR: versions.env allows only comments, blank lines and KEY=value (value: [A-Za-z0-9._-]):" >&2
  echo "${bad}" >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
. "${VERSIONS}"
set +a
for key in "${REQUIRED[@]}"; do
  if [[ -z "${!key:-}" ]]; then
    echo "ERROR: versions.env is missing ${key}" >&2
    exit 1
  fi
done
if ! [[ "${NODE_MAJOR}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: NODE_MAJOR must be a bare major (got '${NODE_MAJOR}')" >&2
  exit 1
fi

ENGINES=">=${NODE_MAJOR}.0.0 <$((NODE_MAJOR + 1)).0.0"
types_node() { node -p "require('${REPO_ROOT}/package.json').devDependencies?.['@types/node'] ?? ''"; }
TYPES_BEFORE=$(types_node)

echo "Syncing from versions.env: node=${NODE_MAJOR} alpine=${ALPINE_VERSION} corepack=${COREPACK_VERSION} pnpm=${PNPM_VERSION}"

# Run a command that rewrites $1 and report whether it changed.
changed() {
  local file="$1" before
  before=$(cat "${file}")
  shift
  "$@"
  if [[ "${before}" != "$(cat "${file}")" ]]; then
    echo "  updated: ${file#"${REPO_ROOT}"/}"
  fi
}

# ── 1. engines.node + @types/node (both packages); alpine/corepack (root) ────
# @types/node: only the MAJOR is corrected. An in-major floor (e.g. ^26.1.0) is a
# deliberate choice that still resolves to the newest 26.x, so it is left alone.
# `pnpm update --latest` never touches it (updateConfig.ignoreDependencies in both
# pnpm-workspace.yaml files) — this script is its only writer.
write_pkg() {
  # shellcheck disable=SC2016 # single-quoted on purpose: a JS template literal, not shell
  PKG_PATH="$1" ROOT_PKG="$2" ENGINES="${ENGINES}" node -e '
    const fs = require("fs");
    const { PKG_PATH, ROOT_PKG, ENGINES, NODE_MAJOR, ALPINE_VERSION, COREPACK_VERSION } = process.env;
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
    pkg.engines = { ...pkg.engines, node: ENGINES };
    const typesNode = pkg.devDependencies?.["@types/node"];
    if (typesNode && /^\D*(\d+)\./.exec(typesNode)?.[1] !== NODE_MAJOR) {
      pkg.devDependencies["@types/node"] = `^${NODE_MAJOR}.0.0`;
    }
    if (ROOT_PKG === "1") {
      pkg.alpineVersion = ALPINE_VERSION;
      pkg.corepackVersion = COREPACK_VERSION;
    }
    fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
  '
}
changed "${REPO_ROOT}/package.json" write_pkg "${REPO_ROOT}/package.json" 1
changed "${REPO_ROOT}/telemetry-backend/package.json" write_pkg "${REPO_ROOT}/telemetry-backend/package.json" 0

# ── 2. packageManager (pnpm) ─────────────────────────────────────────────────
# Corepack writes the field WITH its sha512 integrity hash, so it is the writer when
# available. Without pnpm (the CI drift job) the bare `pnpm@<ver>` is written, which
# the job's git diff then reports as drift.
CURRENT_PM=$(node -p "require('${REPO_ROOT}/package.json').packageManager ?? ''")
if [[ "${CURRENT_PM}" != "pnpm@${PNPM_VERSION}+"* && "${CURRENT_PM}" != "pnpm@${PNPM_VERSION}" ]]; then
  echo "  packageManager: ${CURRENT_PM%%+*} -> pnpm@${PNPM_VERSION}"
  if command -v pnpm >/dev/null 2>&1; then
    (cd "${REPO_ROOT}" && pnpm dlx "corepack@${COREPACK_VERSION}" use "pnpm@${PNPM_VERSION}")
  else
    PM="pnpm@${PNPM_VERSION}" node -e '
      const fs = require("fs"); const p = process.argv[1];
      const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
      pkg.packageManager = process.env.PM;
      fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
    ' "${REPO_ROOT}/package.json"
    echo "  pnpm not available — wrote packageManager without its integrity hash; run 'pnpm sync:versions' locally."
  fi
fi

# ── 3. Re-resolve lockfiles if the @types/node range moved ──────────────────
TYPES_AFTER=$(types_node)
if [[ "${TYPES_BEFORE}" != "${TYPES_AFTER}" ]]; then
  echo "  @types/node: ${TYPES_BEFORE:-<unset>} -> ${TYPES_AFTER}"
  if command -v pnpm >/dev/null 2>&1; then
    echo "  re-resolving lockfiles..."
    (cd "${REPO_ROOT}" && pnpm install --silent) ||
      echo "  WARNING: root 'pnpm install' failed — run it manually so pnpm-lock.yaml re-resolves." >&2
    (cd "${REPO_ROOT}/telemetry-backend" && pnpm install --silent) ||
      echo "  WARNING: telemetry-backend 'pnpm install' failed — run it manually." >&2
  else
    echo "  pnpm not available — skipping lockfile re-resolve; run 'pnpm install' in both packages."
  fi
fi

echo "Done."

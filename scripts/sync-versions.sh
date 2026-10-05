#!/usr/bin/env bash
# sync-versions.sh — derive Node-version-dependent fields from the root package.json.
# Source of truth: package.json "engines.node" (major parsed by scripts/node-major.sh).
# pnpm needs no sync — mise and corepack both read package.json "packageManager".
# Alpine needs no sync — mise.toml [vars] alpine_version is read via scripts/alpine-version.sh.
# Derived files: telemetry-backend/package.json engines.node + devDependencies['@types/node']
# in both packages, re-resolving both lockfiles when the range moves.
# Dockerfiles/compose files carry no version defaults — they require NODE_VERSION
# at build time (exported by mise, passed explicitly in CI).
# Run after editing engines.node. Idempotent: running twice produces no diff.
#
# Usage:
#   bash scripts/sync-versions.sh          # from repo root
#   pnpm sync:versions                     # via pnpm script alias
#   mise run sync-versions                 # via mise task
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

NODE=$(sh "${REPO_ROOT}/scripts/node-major.sh")
ENGINES=$(node -p "require('${REPO_ROOT}/package.json').engines.node")

# Captured before any rewrite so the final step can tell whether the range
# actually moved and only then pay for a re-resolve.
TYPES_BEFORE=$(node -p "require('${REPO_ROOT}/package.json').devDependencies['@types/node'] ?? ''" 2>/dev/null || echo '')

echo "Syncing: node=${NODE}"

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

# ── 1. Derived package.json fields ───────────────────────────────────────────
#
# telemetry-backend engines.node: copied verbatim from the root (the source).
# devDependencies['@types/node'] in both packages: MUST track the Node major —
# `pnpm update --latest` otherwise drifts it to the newest release line (^25, ^26, …)
# while the runtime stays on ${NODE}, so the types describe APIs the runtime lacks.

for pkg_json in "${REPO_ROOT}/package.json" "${REPO_ROOT}/telemetry-backend/package.json"; do
  changed "${pkg_json}" \
    node -e "
      const fs = require('fs');
      const path = '${pkg_json}';
      const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
      pkg.engines = pkg.engines ?? {};
      pkg.engines.node = '${ENGINES}';
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
done

# ── 3. Re-resolve lockfiles if the @types/node range moved ──────────────────
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

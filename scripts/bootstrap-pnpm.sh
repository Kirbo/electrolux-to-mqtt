#!/bin/sh
# bootstrap-pnpm.sh — install the pinned Corepack, then activate the pnpm from
# package.json "packageManager" (version + sha512 integrity).
#
# Node 25+ no longer bundles Corepack, so it is installed explicitly from npm
# (still bundled). The version is pinned in the root package.json
# "corepackVersion" — the single source of truth; the Dockerfiles read the same key
# with `node -p` because this script is not in their build context before install.
#
# Used by every GitLab CI job that needs pnpm. Run from any cwd; activates pnpm
# for the repo root.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
version=$(sed -n 's/^[[:space:]]*"corepackVersion"[[:space:]]*:[[:space:]]*"\([0-9][0-9.]*\)".*/\1/p' "$ROOT/package.json" | head -1)
if [ -z "$version" ]; then
  echo "ERROR: could not parse \"corepackVersion\" from $ROOT/package.json" >&2
  exit 1
fi

npm install --global --no-audit --no-fund "corepack@${version}"
corepack enable
cd "$ROOT"
corepack install

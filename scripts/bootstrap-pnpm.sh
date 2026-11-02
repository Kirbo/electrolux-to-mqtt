#!/bin/sh
# bootstrap-pnpm.sh — install the pinned Corepack, then activate the pnpm from
# package.json "packageManager" (version + sha512 integrity).
#
# Node 25+ no longer bundles Corepack, so it is installed explicitly from npm
# (still bundled) at COREPACK_VERSION from versions.env — the single source of truth
# for every version. The Dockerfiles receive the same value as a build-arg.
#
# Used by every GitLab CI job that needs pnpm. Run from any cwd; activates pnpm
# for the repo root.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
version=$(sed -n 's/^COREPACK_VERSION=//p' "$ROOT/versions.env")
if [ -z "$version" ]; then
  echo "ERROR: versions.env has no COREPACK_VERSION" >&2
  exit 1
fi

npm install --global --no-audit --no-fund "corepack@${version}"
corepack enable
cd "$ROOT"
corepack install

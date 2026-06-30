#!/usr/bin/env bash
# Generate a full changelog from the latest stable release to HEAD, suitable
# for use as a Merge Request description.
#
# Usage:
#   ./scripts/mr-description.sh              # prints to stdout
#   ./scripts/mr-description.sh > MR.md      # writes to a file
#
# Requires Docker (uses orhunp/git-cliff:latest, same image as CI).

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)

# Latest stable tag: vYYYY.M.MICRO or vMAJOR.MINOR.PATCH — no bN or -rc suffix.
# `|| true`: with no matching tags, grep exits 1 and `set -o pipefail` would abort here (set -e),
# bypassing the friendly "no stable tag found" message below. Let it fall through to empty instead.
LATEST_STABLE=$(git tag --list 'v*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 || true)

if [ -z "${LATEST_STABLE}" ]; then
  echo "error: no stable tag found" >&2
  exit 1
fi

echo "Changelog since ${LATEST_STABLE}:" >&2

docker run --rm \
  -v "${ROOT}:/repo" \
  -w /repo \
  -e GIT_CONFIG_COUNT=1 \
  -e GIT_CONFIG_KEY_0=safe.directory \
  -e GIT_CONFIG_VALUE_0='*' \
  orhunp/git-cliff:latest \
  --config cliff.toml \
  --ignore-tags '(-rc\.[0-9]+|b[0-9]+)$' \
  --tag "next" \
  "${LATEST_STABLE}..HEAD"

#!/usr/bin/env bash
# Generate the full changelog between main and next — the exact set of commits a
# next -> main merge request proposes — for use as that MR's description.
#
# Usage:
#   ./scripts/mr-description.sh                    # origin/main..origin/next
#   ./scripts/mr-description.sh <BASE> <HEAD>      # explicit refs
#   ./scripts/mr-description.sh > MR.md
#
#   MR_TAG=2026.8.0 ./scripts/mr-description.sh    # label the unreleased section
#
# Defaults to the REMOTE refs, not local branches: an MR contains what is on the
# remote, so unpushed local commits must not appear in its description. A normal
# clone of this repo also has no local `main`.
#
# Does NOT fetch — a network call inside a generator is surprising, and it would
# mask a stale checkout rather than surface it. Fetch first (the /merge-request
# skill does). The resolved refs and SHAs are printed to stderr so the output is
# auditable after the fact.
#
# Uses git-cliff from PATH when available, else Docker (orhunp/git-cliff:latest,
# the same image CI uses).

set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
BASE_REF=${1:-origin/main}
HEAD_REF=${2:-origin/next}
MR_TAG=${MR_TAG:-next}

for ref in "${BASE_REF}" "${HEAD_REF}"; do
  if ! git rev-parse --verify --quiet "${ref}" >/dev/null; then
    echo "error: ref '${ref}' not found. Fetch first (git fetch origin), or pass explicit refs." >&2
    exit 1
  fi
done

COUNT=$(git rev-list --count "${BASE_REF}..${HEAD_REF}")
if [ "${COUNT}" -eq 0 ]; then
  echo "error: no commits between ${BASE_REF} and ${HEAD_REF} — nothing to describe." >&2
  exit 1
fi

{
  echo "Changelog for ${BASE_REF}..${HEAD_REF} (${COUNT} commits)"
  echo "  ${BASE_REF} = $(git rev-parse --short "${BASE_REF}")"
  echo "  ${HEAD_REF} = $(git rev-parse --short "${HEAD_REF}")"
} >&2

# --ignore-tags folds the beta tags cut from `next` into a single unreleased
# section, so the MR reads as one release rather than a run of betas.
CLIFF_ARGS=(
  --config cliff.toml
  --ignore-tags '(-rc\.[0-9]+|b[0-9]+)$'
  --tag "${MR_TAG}"
  "${BASE_REF}..${HEAD_REF}"
)

if command -v git-cliff >/dev/null 2>&1; then
  (cd "${ROOT}" && git-cliff "${CLIFF_ARGS[@]}")
elif command -v docker >/dev/null 2>&1; then
  docker run --rm \
    -v "${ROOT}:/repo" \
    -w /repo \
    -e GIT_CONFIG_COUNT=1 \
    -e GIT_CONFIG_KEY_0=safe.directory \
    -e GIT_CONFIG_VALUE_0='*' \
    orhunp/git-cliff:latest \
    "${CLIFF_ARGS[@]}"
else
  echo "error: neither git-cliff nor docker is available." >&2
  echo "  install git-cliff (mise use git-cliff) or start Docker." >&2
  exit 1
fi

#!/bin/sh
# compute-version.sh — compute the next CalVer and write the release metadata
# consumed by later CI jobs. Extracted from the "bump version" job.
#
# CalVer, Home Assistant style: stable "YYYY.M.MICRO", beta "YYYY.M.MICRObN".
# MICRO is 0-based per month, betas are 1-based. The month is non-padded;
# BusyBox `date` has no %-m, so strip a single leading zero explicitly.
#
# Inputs (env): CI_COMMIT_BRANCH
# Requires: git history with tags fetched (git fetch --tags --force).
# Outputs (repo root):
#   .version-unreleased        — bare version string
#   build.env                  — VERSION=... + CHANGELOG_RANGE=... (sourceable)
#   sonar-project.properties   — sonar.projectVersion appended
set -eu

YEAR=$(date -u +%Y)
MONTH=$(date -u +%m); MONTH=${MONTH#0}
ALL_TAGS=$(git tag --list 'v*')
# Next stable base for this year.month: (highest stable micro)+1, else .0.
BASE=$(printf '%s\n' "$ALL_TAGS" | sh scripts/compute-calver-base.sh "$YEAR" "$MONTH")
echo "[compute-version] year=${YEAR} month=${MONTH} stable_base=${BASE}"

if [ "${CI_COMMIT_BRANCH:-}" = "next" ]; then
  # Beta track: append bN ((highest beta for this base)+1, else b1).
  VERSION=$(printf '%s\n' "$ALL_TAGS" | sh scripts/compute-calver-beta.sh "$BASE")
  # Incremental release notes: commits since the nearest tag (last beta/stable).
  PREV=$(git describe --tags --abbrev=0 HEAD 2>/dev/null || true)
  # Safeguard: the next branch must always carry a bN pre-release suffix.
  case "$VERSION" in
    *b[0-9]*) ;;
    *) echo "[compute-version] ERROR: '${VERSION}' has no bN suffix on next branch"; exit 1 ;;
  esac
else
  # Stable track: the bare CalVer base.
  VERSION=$BASE
  # Release notes: commits since the last STABLE tag (beta/rc commits fold in).
  PREV=$(git describe --tags --abbrev=0 --match 'v[0-9]*' --exclude '*b[0-9]*' --exclude '*-rc.*' HEAD 2>/dev/null || true)
fi

# First release ever (no prior tag): fall back to the repo root commit.
if [ -z "$PREV" ]; then
  PREV=$(git rev-list --max-parents=0 HEAD | tail -n 1)
fi

echo "[compute-version] version=${VERSION} range=${PREV}..HEAD"
printf '%s\n' "$VERSION" > .version-unreleased
{
  printf 'VERSION=%s\n' "$VERSION"
  printf 'CHANGELOG_RANGE=%s..HEAD\n' "$PREV"
} > build.env
printf 'sonar.projectVersion=%s\n' "$VERSION" >> sonar-project.properties

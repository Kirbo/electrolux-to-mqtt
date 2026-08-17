#!/bin/sh
# generate-release-notes.sh — produce UNRELEASED-CHANGELOG.md for the pending
# release. Extracted from the "generate release notes" job (git-cliff image).
#
# git-cliff produces the per-release notes in the go-semantic-release default
# format (see cliff.toml). It replaces go-semantic-release's GENERATOR only —
# combine-changelogs still AGGREGATES these into the full CHANGELOG.md.
# On main, pre-release tags inside the range (old -rc.N and new bN) fold into
# the stable section. git-cliff writes to a temp file rather than piping into
# sed, so a git-cliff failure fails the job instead of being masked by sed's
# exit code (dash has no reliable pipefail).
#
# Inputs (env): CI_COMMIT_BRANCH; VERSION + CHANGELOG_RANGE from build.env.
set -eu

. ./build.env

if [ "${CI_COMMIT_BRANCH:-}" = "main" ]; then
  git-cliff --config cliff.toml --ignore-tags '(-rc\.[0-9]+|b[0-9]+)$' --tag "v${VERSION}" "${CHANGELOG_RANGE}" > notes.tmp
else
  git-cliff --config cliff.toml --tag "v${VERSION}" "${CHANGELOG_RANGE}" > notes.tmp
fi
sed '1{/^$/d;}' notes.tmp > UNRELEASED-CHANGELOG.md
rm -f notes.tmp

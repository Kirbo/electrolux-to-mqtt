#!/bin/sh
# Compute the next beta tag for a given stable CalVer base.
#
# Usage:
#   git tag --list 'v*' | scripts/compute-calver-beta.sh <BASE>
#
# $1 = base (e.g. 2026.6.0)
#
# Reads candidate tags on stdin (one per line). Keeps only lines matching
# exactly "v<BASE>b<digits>". Prints "<BASE>b<N>" to stdout where N is:
#   - (highest matched beta number) + 1  when at least one beta tag exists, or
#   - 1                                  when no beta tag exists for this base
#     (betas are 1-based — first beta of a base is b1).
#
# No git calls happen here — tags are read from stdin so the logic is pure and
# unit-testable (see tests/compute-calver-beta.test.ts).
set -eu

BASE="${1:?usage: compute-calver-beta.sh <base>}"

# Escape dots so they are matched literally in the BRE below.
base_re=$(printf '%s' "$BASE" | sed 's/[.]/\\./g')

# Keep only lines that are exactly "v<BASE>b<digits>" (tolerating trailing
# whitespace such as a CR), emit the digits, then take the numeric maximum.
max=$(sed -n "s/^v${base_re}b\([0-9][0-9]*\)[[:space:]]*\$/\1/p" | sort -n | tail -n 1)

if [ -z "${max:-}" ]; then
  max=0
fi

echo "${BASE}b$((max + 1))"

#!/bin/sh
# Compute the next stable CalVer base version for a given year + month.
#
# Usage:
#   git tag --list 'v*' | scripts/compute-calver-base.sh <YYYY> <M>
#
# $1 = year  (e.g. 2026)
# $2 = month (non-padded, e.g. 6 — caller strips any leading zero)
#
# Reads candidate tags on stdin (one per line). Keeps only lines matching
# exactly "v<YYYY>.<M>.<digits>" (stable tags — no beta suffix). Prints
# "<YYYY>.<M>.<MICRO>" to stdout where MICRO is:
#   - (highest matched micro) + 1  when at least one stable tag exists, or
#   - 0                            when no stable tag exists for that month
#     (micro is 0-based per HA-style CalVer — first stable of a month is .0).
#
# No git calls happen here — tags are read from stdin so the logic is pure and
# unit-testable (see tests/compute-calver-base.test.ts).
set -eu

YEAR="${1:?usage: compute-calver-base.sh <YYYY> <M>}"
MONTH="${2:?usage: compute-calver-base.sh <YYYY> <M>}"

# Escape dots so they are matched literally in the BRE below.
prefix_re=$(printf '%s.%s' "$YEAR" "$MONTH" | sed 's/[.]/\\./g')

# Keep only lines that are exactly "v<YYYY>.<M>.<digits>" (no beta suffix,
# tolerating trailing whitespace such as a CR), emit the micro digits, then
# take the numeric maximum.
max=$(sed -n "s/^v${prefix_re}\.\([0-9][0-9]*\)[[:space:]]*\$/\1/p" | sort -n | tail -n 1)

if [ -z "${max:-}" ]; then
  micro=0
else
  micro=$((max + 1))
fi

echo "${YEAR}.${MONTH}.${micro}"

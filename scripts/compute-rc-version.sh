#!/bin/sh
# Compute the next release-candidate version for a given base version.
#
# Usage:
#   git tag --list "v${BASE}-rc.*" | scripts/compute-rc-version.sh "${BASE}"
#
# Reads candidate tags on stdin (one per line, e.g. "v1.18.5-rc.5") and prints
# "${BASE}-rc.N" to stdout, where N is:
#   - the highest existing rc number for ${BASE}, plus 1; or
#   - 1, when no rc tag exists for ${BASE}.
#
# The rc number therefore always advances. A base-version bump (e.g. a feat
# moving 1.18.5 -> 1.19.0) yields a base with no rc tags yet, so it naturally
# resets to rc.1. Comparison is numeric, so rc.10 ranks above rc.9.
#
# No git calls happen here — tags are read from stdin so the logic is pure and
# unit-testable (see tests/compute-rc-version.test.ts).
set -eu

BASE="${1:?usage: compute-rc-version.sh <base-version> < tags}"

# Escape dots so they are matched literally in the BRE below.
base_re=$(printf '%s' "$BASE" | sed 's/[.]/\\./g')

# Keep only lines that are exactly "v<BASE>-rc.<digits>" (tolerating trailing
# whitespace such as a CR), emit the digits, then take the numeric maximum.
max=$(sed -n "s/^v${base_re}-rc\.\([0-9][0-9]*\)[[:space:]]*\$/\1/p" | sort -n | tail -n 1)

if [ -z "${max:-}" ]; then
  max=0
fi

echo "${BASE}-rc.$((max + 1))"

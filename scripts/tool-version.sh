#!/bin/sh
# tool-version.sh — print a tool's version pin from mise.toml [tools].
#
# Usage: sh scripts/tool-version.sh <tool>      e.g. git-cliff -> 2.14.2
#
# mise.toml [tools] is the single source of truth for dev/CI tools that never ship
# in an image (git-cliff, sops, age). mise installs them locally; CI reads the same
# pin through this script — e.g. the git-cliff image tag — so local and CI output
# match. (Node, pnpm and Alpine live in package.json — see node-major.sh /
# alpine-version.sh.)
#
# Plain POSIX sh + sed: runs on bare CI images before any tooling exists. Only
# matches simple `name = "x.y.z"` lines, which is how these pins are written.
set -eu

if [ $# -ne 1 ]; then
  echo "usage: $0 <tool>" >&2
  exit 2
fi

MISE_TOML="$(dirname "$0")/../mise.toml"
version=$(sed -n "s/^$1 *= *\"\\([0-9][0-9.]*\\)\".*/\\1/p" "$MISE_TOML" | head -1)
if [ -z "$version" ]; then
  echo "ERROR: could not parse [tools] $1 from $MISE_TOML" >&2
  exit 1
fi
echo "$version"

#!/bin/sh
# alpine-version.sh — print the Alpine version from mise.toml [vars] alpine_version.
#
# SINGLE SOURCE OF TRUTH for the Alpine version of every Node image (the Node major
# lives in package.json engines.node — see scripts/node-major.sh). Every consumer
# reads it through this script or through the ALPINE_VERSION that mise exports:
# GitLab CI (folded into NODE_VERSION=<major>-alpine<ver>), the telemetry deploy
# jobs, and scripts/docker-build-test.sh. Dockerfiles/compose cannot read files, so
# they take the ALPINE_VERSION (or combined NODE_VERSION) build-arg instead.
#
# Plain POSIX sh + sed: runs on the bare alpine CI image before any tooling exists.
set -eu

MISE_TOML="$(dirname "$0")/../mise.toml"
version=$(sed -n 's/^alpine_version *= *"\([0-9.]*\)".*/\1/p' "$MISE_TOML" | head -1)
if [ -z "$version" ]; then
  echo "ERROR: could not parse [vars] alpine_version from $MISE_TOML" >&2
  exit 1
fi
echo "$version"

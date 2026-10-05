#!/bin/sh
# alpine-version.sh — print the Alpine version from the root package.json "alpineVersion".
#
# SINGLE SOURCE OF TRUTH for the Alpine version of every Node image (the Node major
# is engines.node in the same file — see scripts/node-major.sh). It lives in
# package.json so a bump touches a release-gated path and cuts a new image. Every consumer
# reads it through this script or through the ALPINE_VERSION that mise exports:
# GitLab CI (folded into NODE_VERSION=<major>-alpine<ver>), the telemetry deploy
# jobs, and scripts/docker-build-test.sh. Dockerfiles/compose cannot read files, so
# they take the ALPINE_VERSION (or combined NODE_VERSION) build-arg instead.
#
# Plain POSIX sh + sed: runs on the bare alpine CI image before any tooling exists.
set -eu

PKG="$(dirname "$0")/../package.json"
version=$(sed -n 's/^[[:space:]]*"alpineVersion"[[:space:]]*:[[:space:]]*"\([0-9][0-9.]*\)".*/\1/p' "$PKG" | head -1)
if [ -z "$version" ]; then
  echo "ERROR: could not parse \"alpineVersion\" from $PKG" >&2
  exit 1
fi
echo "$version"

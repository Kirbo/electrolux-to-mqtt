#!/bin/sh
# node-major.sh — print the Node.js major from the root package.json "engines.node".
#
# SINGLE SOURCE OF TRUTH for the Node.js version. Every consumer reads it through
# this script: mise ([tools] node + [env] NODE_VERSION), GitLab CI, the git hooks,
# the telemetry deploy jobs, scripts/docker-build-test.sh and scripts/sync-versions.sh.
# Dockerfiles/compose cannot read files, so they take the NODE_VERSION build-arg
# that mise / CI derive from here.
#
# Plain POSIX sh + sed on purpose: it runs before Node exists (mise bootstrapping
# Node itself, the bare alpine CI image), so it cannot use `node -p`.
# The first integer of the range is the major: ">=24.0.0 <25.0.0" -> 24.
set -eu

PKG="$(dirname "$0")/../package.json"
major=$(sed -n 's/^[[:space:]]*"node"[[:space:]]*:[[:space:]]*"[^0-9]*\([0-9][0-9]*\).*/\1/p' "$PKG" | head -1)
if [ -z "$major" ]; then
  echo "ERROR: could not parse engines.node from $PKG" >&2
  exit 1
fi
echo "$major"

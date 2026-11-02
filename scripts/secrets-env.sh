#!/bin/sh
# secrets-env.sh — write telemetry-backend/.env (gitignored, mode 0600) from the fnox
# `telemetry` profile, for `pnpm backend:docker` (compose reads it via env_file).
#
# The server gets the same file from the `deploy telemetry-backend` CI job, piped over
# ssh (never written on the runner). Needs the maintainer identity (`pnpm secrets:setup`).
set -eu

cd "$(dirname "$0")/.."
umask 077
fnox export --no-defaults --if-missing error -P telemetry --format env -o telemetry-backend/.env
echo "Wrote telemetry-backend/.env ($(grep -c '=' telemetry-backend/.env) keys)"

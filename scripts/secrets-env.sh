#!/bin/sh
# secrets-env.sh — write telemetry-backend/.env (gitignored, mode 0600) from the fnox
# `telemetry` profile, for `pnpm backend:docker` (compose reads it via env_file).
#
# Maintainer machines only: it needs the maintainer identity (`pnpm secrets:setup`
# writes fnox.local.toml) or a FNOX_AGE_KEY / FNOX_AGE_KEY_FILE. The server never has
# a key — the `deploy telemetry-backend` CI job writes its .env, piped over ssh.
#
# The file is replaced atomically (temp file + mv), so a failed export never leaves a
# missing or half-written .env behind.
set -eu

cd "$(dirname "$0")/.."

if [ ! -f fnox.local.toml ] && [ -z "${FNOX_AGE_KEY:-}" ] && [ -z "${FNOX_AGE_KEY_FILE:-}" ]; then
  echo "secrets:env: no maintainer key on this machine (no fnox.local.toml)." >&2
  echo "  - Maintainer machine: run 'pnpm secrets:setup' once, then retry." >&2
  echo "  - Telemetry server: nothing to do — the 'deploy telemetry-backend' CI job writes" >&2
  echo "    telemetry-backend/.env there. The existing file was left untouched." >&2
  exit 1
fi

umask 077
tmp="telemetry-backend/.env.tmp.$$"
trap 'rm -f "${tmp}"' EXIT
fnox export --no-defaults --if-missing error -P telemetry --format env -o "${tmp}"
mv "${tmp}" telemetry-backend/.env
echo "Wrote telemetry-backend/.env ($(grep -c '=' telemetry-backend/.env) keys)"

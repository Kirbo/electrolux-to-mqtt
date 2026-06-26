#!/bin/sh
set -eu

# Decrypt telemetry-backend/.env.enc -> telemetry-backend/.env in the CI runner. The
# `deploy telemetry-backend` job then scp's the plaintext .env to the server and removes it (the
# server never stores sops or the key). Run via the deploy job's *deploy_backend_env step.
#
# Needs the age key as a CI/CD variable: File-type SOPS_AGE_KEY_FILE (preferred — GitLab materializes
# it as a temp file, sops reads the path; set it with `pnpm sops:sync-ci`) OR a masked SOPS_AGE_KEY
# (the raw key). sops reads either automatically. CI/CD variables are safe on a public repo: never
# shown to non-members, masked ones never hit logs. sops decrypts the post-quantum age recipient
# natively (no `age` binary required); it comes from mise (see mise.toml).

if [ -z "${SOPS_AGE_KEY:-}" ] && [ -z "${SOPS_AGE_KEY_FILE:-}" ]; then
  echo "ERROR: no age key in the environment. Set the File-type CI/CD variable SOPS_AGE_KEY_FILE" >&2
  echo "       (preferred — run 'pnpm sops:sync-ci') or a masked SOPS_AGE_KEY. Neither is set." >&2
  exit 1
fi

# Same flags as scripts/sops-env.sh (binary in/out = byte-exact, no dotenv guessing). Owner-only.
umask 077
sops --decrypt --input-type binary --output-type binary telemetry-backend/.env.enc > telemetry-backend/.env
echo "Decrypted telemetry-backend/.env ($(grep -c '=' telemetry-backend/.env) keys)"

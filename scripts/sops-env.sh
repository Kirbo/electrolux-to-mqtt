#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [encrypt|decrypt]" >&2
  exit 1
}

[[ $# -ne 1 ]] && usage
[[ "$1" != "encrypt" && "$1" != "decrypt" ]] && usage

AGE_KEY=$(op item get 'electrolux-to-mqtt age key' \
  --vault=Personal \
  --account=my.1password.com \
  --fields 'private key' \
  --format json \
  | jq -r '.value')

# Scope to the two known env roots (repo root + telemetry-backend), maxdepth 1
# so we never descend into node_modules/dist/coverage and encrypt stray .env files.
#
# --input-type/--output-type binary: treat each .env as an opaque blob. sops
# otherwise picks the store from the filename (.env → dotenv, .enc → json on
# decrypt), which mismatches and also risks mangling quoted/special-char values.
# Binary is byte-exact and filename-independent.
if [[ "$1" == "encrypt" ]]; then
  files=$(find . telemetry-backend -maxdepth 1 -name ".env*" ! -name "*.enc" ! -name ".env.example" | sort)
  if [[ -z "${files}" ]]; then
    echo "No .env files found to encrypt" >&2
    exit 1
  fi
  while IFS= read -r src; do
    dst="${src}.enc"
    SOPS_AGE_KEY="${AGE_KEY}" sops --encrypt --input-type binary --output-type binary "${src}" > "${dst}"
    echo "Encrypted ${src} → ${dst}"
  done <<< "${files}"
else
  files=$(find . telemetry-backend -maxdepth 1 -name ".env*.enc" | sort)
  if [[ -z "${files}" ]]; then
    echo "No .env*.enc files found to decrypt" >&2
    exit 1
  fi
  while IFS= read -r src; do
    dst="${src%.enc}"
    SOPS_AGE_KEY="${AGE_KEY}" sops --decrypt --input-type binary --output-type binary "${src}" > "${dst}"
    echo "Decrypted ${src} → ${dst}"
  done <<< "${files}"
fi

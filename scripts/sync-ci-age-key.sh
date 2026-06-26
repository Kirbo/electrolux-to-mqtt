#!/usr/bin/env bash
set -euo pipefail

# Push the SOPS age PRIVATE key into the project's GitLab CI/CD variable SOPS_AGE_KEY_FILE (File-type:
# GitLab materializes it as a temp file and the env var holds its PATH — sops reads it as a key file,
# keeping the key out of the job environment block). The CI `deploy telemetry-backend` job then
# decrypts telemetry-backend/.env.enc with it (see ci/decrypt-env.sh). Idempotent (create or update)
# via scripts/gitlab-set-ci-var.sh.
#
# Reads BOTH secrets from 1Password (nothing touches disk):
#   - the age private key   ← item "electrolux-to-mqtt age key"        (field "private key")
#   - the GitLab PAT (auth)  ← item $SOPS_CI_PAT_ITEM (default below)   (field "password")
#
# Run standalone for first-time setup, or let `pnpm sops:rotate` call it after a rotation. CI/CD
# variables are safe on a public repo — unlike job artifacts they're never shown to non-members and
# masked ones never print in logs. The PAT needs `api` scope + Maintainer+ on this project (a user PAT
# with `api` scope works across all your projects, so the same token used elsewhere is fine).

VAULT="Personal"
OP_ACCOUNT="my.1password.com" # the personal-account sign-in address `op --account` resolves —
                              # matches the sops-*.sh scripts.
AGE_ITEM="electrolux-to-mqtt age key"
# 1Password item holding a GitLab PAT (api scope). Override if yours is named differently or to reuse
# a token shared with another project: SOPS_CI_PAT_ITEM="Some - GitLab API Token" pnpm sops:sync-ci
PAT_ITEM="${SOPS_CI_PAT_ITEM:-electrolux-to-mqtt - GitLab API Token}"

for cmd in op curl jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command '$cmd' not found in PATH" >&2
    exit 1
  fi
done

# shellcheck source=scripts/op-ensure-signin.sh
. "$(dirname "$0")/op-ensure-signin.sh"
op_ensure_signin "${OP_ACCOUNT}"

# Pull both secrets from 1Password.
AGE_KEY=$(op item get "${AGE_ITEM}" --vault="${VAULT}" --account="${OP_ACCOUNT}" \
  --fields 'private key' --format json | jq -r '.value')
PAT=$(op read "op://${VAULT}/${PAT_ITEM}/password" --account "${OP_ACCOUNT}")

if [[ -z "${AGE_KEY}" || "${AGE_KEY}" == "null" ]]; then
  echo "Error: age private key from 1Password is empty" >&2
  exit 1
fi
if [[ -z "${PAT}" ]]; then
  echo "Error: GitLab PAT from 1Password is empty (item: ${PAT_ITEM})" >&2
  exit 1
fi

# Create/update the masked + protected File-type SOPS_AGE_KEY_FILE variable.
GITLAB_PAT="${PAT}" CI_VAR_KEY="SOPS_AGE_KEY_FILE" CI_VAR_VALUE="${AGE_KEY}" \
  "$(dirname "$0")/gitlab-set-ci-var.sh"

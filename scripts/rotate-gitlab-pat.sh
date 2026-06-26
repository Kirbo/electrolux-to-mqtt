#!/usr/bin/env bash
set -euo pipefail

# Self-rotate the GitLab access token used to authorize this project's CI-var automation, then write
# the new token back to 1Password. The token rotates ITSELF (the `self/rotate` endpoint), so the old
# value is revoked the instant the new one is issued — run this on a schedule (or before expiry).
#
# This PAT is used only LOCALLY by `pnpm sops:sync-ci` (scripts/sync-ci-age-key.sh) to authorize the
# API call that sets the SOPS_AGE_KEY_FILE CI/CD variable. It is NOT itself stored as a CI variable
# (this repo's pipeline authenticates with CI_JOB_TOKEN for releases), so there is nothing to mirror
# into CI after rotation — the next `pnpm sops:sync-ci` simply reads the new value from 1Password.
#
# Works for both a PROJECT access token (scoped to this repo; needs Maintainer role + `api` scope —
# Maintainer because gitlab-set-ci-var.sh updates CI/CD variables) and a personal one;
# `personal_access_tokens/self/rotate` accepts project access tokens too, so this is token-kind-agnostic.
#
# 1Password item "electrolux-to-mqtt - GitLab API Token" (Personal vault), value in the `password`
# field. The token needs `api` scope to rotate itself.

# --- Config ------------------------------------------------------------------
VAULT="Personal"
ITEM="electrolux-to-mqtt - GitLab API Token"
OP_ACCOUNT="my.1password.com" # the personal-account sign-in address `op --account` resolves —
                              # matches the sops-*.sh scripts.
GITLAB_HOST="https://gitlab.com"
EXPIRY="1 year" # "<N> <unit>", unit ∈ year|month|week|day. NOTE: gitlab.com caps access-token
                # lifetime at 365 days — if the API rejects the expiry, shorten this (e.g. "11 months").

# --- Preconditions -----------------------------------------------------------
for cmd in op curl jq date; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: required command '$cmd' not found in PATH" >&2
    exit 1
  fi
done

# shellcheck source=scripts/op-ensure-signin.sh
. "$(dirname "$0")/op-ensure-signin.sh"
op_ensure_signin "${OP_ACCOUNT}"

# --- Compute expiration date (cross-platform: BSD `date -v` / GNU `date -d`) --
read -r EXPIRY_AMOUNT EXPIRY_UNIT <<< "${EXPIRY}"

if ! [[ "${EXPIRY_AMOUNT}" =~ ^[0-9]+$ ]] || [[ "${EXPIRY_AMOUNT}" -lt 1 ]]; then
  echo "Error: EXPIRY amount must be a positive integer, got '${EXPIRY_AMOUNT}'" >&2
  exit 1
fi

case "$(echo "${EXPIRY_UNIT}" | tr '[:upper:]' '[:lower:]')" in
  year|years)   BSD_UNIT="y"; GNU_UNIT="year" ;;
  month|months) BSD_UNIT="m"; GNU_UNIT="month" ;;
  week|weeks)   BSD_UNIT="w"; GNU_UNIT="week" ;;
  day|days)     BSD_UNIT="d"; GNU_UNIT="day" ;;
  *) echo "Error: invalid EXPIRY unit '${EXPIRY_UNIT}' (use year|month|week|day)" >&2; exit 1 ;;
esac

if date -v +1d >/dev/null 2>&1; then
  EXPIRES_AT=$(date -v "+${EXPIRY_AMOUNT}${BSD_UNIT}" +%Y-%m-%d)
else
  EXPIRES_AT=$(date -d "+${EXPIRY_AMOUNT} ${GNU_UNIT}" +%Y-%m-%d)
fi

echo "New expiration: ${EXPIRES_AT}"

# --- Read current token from 1Password ---------------------------------------
CURRENT_TOKEN=$(op read "op://${VAULT}/${ITEM}/password" --account "${OP_ACCOUNT}") || {
  echo "Error: failed to read current token from 1Password" >&2
  exit 1
}

if [[ -z "${CURRENT_TOKEN}" ]]; then
  echo "Error: current token is empty" >&2
  exit 1
fi

# --- Rotate via GitLab API ---------------------------------------------------
# Auth header via --config process substitution so the PAT never sits in curl's argv (`ps`-visible).
HTTP_RESPONSE=$(curl --silent --show-error --write-out "\n%{http_code}" \
  --request POST \
  --config <(printf 'header = "PRIVATE-TOKEN: %s"' "${CURRENT_TOKEN}") \
  --url "${GITLAB_HOST}/api/v4/personal_access_tokens/self/rotate?expires_at=${EXPIRES_AT}")

HTTP_CODE=$(echo "${HTTP_RESPONSE}" | tail -n1)
BODY=$(echo "${HTTP_RESPONSE}" | sed '$d')

if [[ "${HTTP_CODE}" -lt 200 || "${HTTP_CODE}" -ge 300 ]]; then
  echo "Error: GitLab API returned HTTP ${HTTP_CODE}" >&2
  echo "${BODY}" | jq . >&2 2>/dev/null || echo "${BODY}" >&2
  exit 1
fi

NEW_TOKEN=$(echo "${BODY}" | jq -r '.token // empty')

if [[ -z "${NEW_TOKEN}" || "${NEW_TOKEN}" == "null" ]]; then
  echo "Error: no token in response body" >&2
  echo "${BODY}" | jq . >&2 2>/dev/null || echo "${BODY}" >&2
  exit 1
fi

# --- Save the new token back to 1Password ------------------------------------
# (`expires` date field is created if the item lacks it — harmless, gives an at-a-glance expiry.)
# NOTE: `op item edit` has no stdin form for field values, so the token IS in op's argv for the
# call's duration (ps-visible) — accepted on this single-user machine.
if ! op item edit "${ITEM}" --vault "${VAULT}" --account "${OP_ACCOUNT}" \
    "password=${NEW_TOKEN}" \
    "expires[date]=${EXPIRES_AT}" >/dev/null; then
  echo "Error: failed to update 1Password item" >&2
  echo "CRITICAL: a new token was issued but NOT saved. Save it manually NOW:" >&2
  echo "${NEW_TOKEN}" >&2
  exit 1
fi

echo "Token rotated and saved to 1Password (expires ${EXPIRES_AT})."
echo "The new token is used by 'pnpm sops:sync-ci' on its next run — nothing to update in CI."

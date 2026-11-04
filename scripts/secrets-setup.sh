#!/usr/bin/env bash
# secrets-setup.sh — one-time per maintainer machine: make fnox decrypt without prompts.
#
#   1. Read the maintainer age identity (native post-quantum form) from 1Password.
#   2. Convert it to the plugin form fnox needs (`age-plugin-pq -identity`).
#   3. Store that in the OS keychain (Secret Service / macOS Keychain / Windows
#      Credential Manager) under service "electrolux-to-mqtt.fnox".
#   4. Generate fnox.local.toml (gitignored) and check every profile resolves.
#
# The key never touches the disk: it is piped from `op` through the plugin into fnox.
# Requires an activated mise (fnox, age-plugin-pq) and the 1Password CLI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
OP_ACCOUNT="${OP_ACCOUNT:-my.1password.com}"
OP_REF="${E2M_AGE_OP_REF:-op://Personal/electrolux-to-mqtt age key/private key}"
PROFILES=(read publish deploy telemetry sonar renovate)

for cmd in fnox age-plugin-pq op; do
  command -v "${cmd}" >/dev/null 2>&1 || { echo "Error: '${cmd}' not on PATH (activate mise; install the 1Password CLI)" >&2; exit 1; }
done

# shellcheck source=scripts/op-ensure-signin.sh
. "${ROOT}/scripts/op-ensure-signin.sh"
op_ensure_signin "${OP_ACCOUNT}"

sh "${ROOT}/scripts/secrets-local-config.sh" --force

echo "Storing the maintainer identity in the OS keychain…"
op read --account "${OP_ACCOUNT}" "${OP_REF}" | age-plugin-pq -identity |
  fnox -c fnox.local.toml set E2M_AGE_IDENTITY --provider keychain >/dev/null
# `fnox set` may append the key to fnox.local.toml; regenerate the canonical form.
sh "${ROOT}/scripts/secrets-local-config.sh"

echo "Checking every profile resolves…"
for p in "${PROFILES[@]}"; do
  fnox check --no-defaults -P "${p}"
done
echo "✓ fnox ready: \`fnox exec -P <profile> -- <cmd>\`, \`pnpm sonar\`, \`pnpm secrets:env\`."

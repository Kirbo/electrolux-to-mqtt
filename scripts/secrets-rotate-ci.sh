#!/usr/bin/env bash
# secrets-rotate-ci.sh <tier> [--no-push] — create or rotate one CI tier's age identity.
#
# Tiers (tier → GitLab environment scope, protected?, fnox profiles it must read):
#   read     ci/read          unprotected  read                (every image build, all branches)
#   publish  release/publish  protected    read, publish       (release image jobs, Docker Hub)
#   deploy   release/deploy   protected    deploy, telemetry   (telemetry-backend server)
#   sonar    ci/sonar         protected    sonar               (SonarCloud)
#
# Steps — the private key exists only in this process's memory:
#   1. Generate a post-quantum age identity (age-keygen -pq) and its plugin form.
#   2. Rewrite every `# ci-<tier>` recipient line in fnox.toml with the new public key.
#   3. Regenerate fnox.local.toml and re-encrypt every profile (maintainer identity).
#   4. Prove the new identity decrypts exactly its profiles and none of the others.
#   5. Store it in GitLab as the File variable FNOX_AGE_KEY_FILE for the tier's scope
#      (PAT from 1Password, like the other maintainer scripts). Skipped with --no-push —
#      the identity is then lost, so only use that for a dry run.
# Commit fnox.toml afterwards: pipelines on older commits can no longer decrypt.
#
# Rotation does not revoke ciphertext already in git history — if a key leaked, rotate
# the VALUES too (`pnpm secrets:set`).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"
TIER="${1:-}"
PUSH=1
[[ "${2:-}" == "--no-push" ]] && PUSH=0
ALL_PROFILES=(read publish deploy telemetry sonar)

case "${TIER}" in
  read) SCOPE="ci/read" PROTECTED=false OWN=(read) ;;
  publish) SCOPE="release/publish" PROTECTED=true OWN=(read publish) ;;
  deploy) SCOPE="release/deploy" PROTECTED=true OWN=(deploy telemetry) ;;
  sonar) SCOPE="ci/sonar" PROTECTED=true OWN=(sonar) ;;
  *) echo "Usage: $0 read|publish|deploy|sonar [--no-push]" >&2; exit 1 ;;
esac

for cmd in fnox age-keygen age-plugin-pq jq; do
  command -v "${cmd}" >/dev/null 2>&1 || { echo "Error: '${cmd}' not on PATH (activate mise)" >&2; exit 1; }
done
[[ -f fnox.local.toml ]] || { echo "Error: no fnox.local.toml — run 'pnpm secrets:setup' first (re-encrypting needs the maintainer identity)" >&2; exit 1; }

# profile_has_secrets <profile> — only profiles holding secrets can prove (non-)access.
profile_has_secrets() { grep -q "^\[profiles\.$1\.secrets\]" fnox.toml; }

# 1. New identity (memory only).
NATIVE=$(age-keygen -pq 2>/dev/null)
RECIPIENT=$(printf '%s\n' "${NATIVE}" | age-keygen -y)
IDENTITY=$(printf '%s\n' "${NATIVE}" | age-plugin-pq -identity)
unset NATIVE

# 2. Recipient lines.
lines=$(grep -c "# ci-${TIER}\$" fnox.toml || true)
[[ "${lines}" -gt 0 ]] || { echo "Error: fnox.toml has no '# ci-${TIER}' recipient line" >&2; exit 1; }
# From here fnox.toml is rewritten for an identity that lives only in this process: on
# any failed exit that identity is gone, so say how to get back to the previous state.
on_exit() {
  local code=$?
  [[ "${code}" -eq 0 ]] && return
  echo "Rotation of ci-${TIER} aborted (exit ${code}). Restore the previous recipients with:" >&2
  echo "  git checkout fnox.toml && sh scripts/secrets-local-config.sh" >&2
  echo "GitLab still holds the old identity unless the 'GitLab' step had already run." >&2
}
trap on_exit EXIT
sed -i.bak -E "s|\"age1[a-z0-9]+\", # ci-${TIER}\$|\"${RECIPIENT}\", # ci-${TIER}|" fnox.toml && rm -f fnox.toml.bak
echo "fnox.toml: ci-${TIER} recipient replaced on ${lines} provider(s)"

# 3. Re-encrypt with the maintainer identity (keychain via fnox.local.toml).
sh scripts/secrets-local-config.sh
for p in "${ALL_PROFILES[@]}"; do
  if profile_has_secrets "${p}"; then fnox reencrypt -f --no-defaults -P "${p}" >/dev/null; fi
done
echo "Re-encrypted every profile"

# 4. Prove access: ONLY the committed config (./fnox.toml — no local identity) + the new key.
as_tier() { FNOX_AGE_KEY="${IDENTITY}" FNOX_NON_INTERACTIVE=true fnox -c ./fnox.toml "$@"; }
for p in "${ALL_PROFILES[@]}"; do
  profile_has_secrets "${p}" || continue
  if [[ " ${OWN[*]} " == *" ${p} "* ]]; then
    as_tier check --no-defaults -P "${p}" >/dev/null || { echo "Error: ci-${TIER} cannot decrypt its profile '${p}'" >&2; exit 1; }
    echo "  ✓ ci-${TIER} decrypts '${p}'"
  else
    if as_tier export --no-defaults --if-missing error -P "${p}" >/dev/null 2>&1; then
      echo "Error: ci-${TIER} can decrypt '${p}', which it must not" >&2
      exit 1
    fi
    echo "  ✓ ci-${TIER} cannot decrypt '${p}'"
  fi
done

# 5. GitLab.
if [[ "${PUSH}" -eq 0 ]]; then
  echo "--no-push: identity discarded; GitLab unchanged (CI for this tier is now broken until a real rotation)."
  exit 0
fi
# shellcheck source=scripts/op-ensure-signin.sh
. "${ROOT}/scripts/op-ensure-signin.sh"
OP_ACCOUNT="${OP_ACCOUNT:-my.1password.com}"
op_ensure_signin "${OP_ACCOUNT}"
PAT_ITEM="${E2M_GITLAB_PAT_ITEM:-electrolux-to-mqtt - GitLab API Token}"
GITLAB_PAT=$(op read "op://Personal/${PAT_ITEM}/password" --account "${OP_ACCOUNT}")
[[ -n "${GITLAB_PAT}" ]] || { echo "Error: GitLab PAT from 1Password is empty (item: ${PAT_ITEM})" >&2; exit 1; }
GITLAB_PAT="${GITLAB_PAT}" CI_VAR_KEY=FNOX_AGE_KEY_FILE CI_VAR_VALUE="${IDENTITY}" \
  CI_VAR_ENV_SCOPE="${SCOPE}" CI_VAR_PROTECTED="${PROTECTED}" bash scripts/gitlab-set-ci-var.sh
echo "✓ ci-${TIER} rotated. Commit fnox.toml now."

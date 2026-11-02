# shellcheck shell=sh
# Sourced by CI jobs that need a secret: `. ci/secrets.sh`, then `secrets_load <profile>…`
# or `secret <NAME> <profile>` for one value.
#
# Every CI secret lives in fnox.toml as age ciphertext, encrypted only to the CI tiers
# that may read it (docs/SECRETS.md). A job's GitLab environment (ci/read, ci/sonar,
# release/publish, release/deploy) scopes exactly ONE File-type variable to it:
# FNOX_AGE_KEY_FILE, that tier's age identity. fnox decrypts with it; GitLab stores
# nothing else.
#
# GitLab masks none of these values in the job log (they are not GitLab variables):
# never `set -x`, never echo them.

# fnox + age-plugin-pq, pinned and verified (versions.env).
sh ci/install-fnox.sh || exit 1
export PATH="${HOME}/.local/bin:${PATH}"

export FNOX_NON_INTERACTIVE=true

_secrets_require_identity() {
  if [ -z "${FNOX_AGE_KEY_FILE:-}" ]; then
    echo "secrets: no FNOX_AGE_KEY_FILE in this job — is its environment (${CI_ENVIRONMENT_NAME:-none}) given one in GitLab, and is the ref protected?" >&2
    exit 1
  fi
}

# secrets_load <profile>… — export the named fnox profiles' secrets into THIS shell.
# Exits the job when the identity cannot decrypt them (a wrong tier is a bug).
secrets_load() {
  _secrets_require_identity
  _sp=$(printf '%s' "$*" | tr ' ' ',')
  if ! _so=$(fnox export --format shell --no-defaults --if-missing error -P "${_sp}"); then
    echo "secrets: this job's identity cannot decrypt fnox profile(s): $* — wrong tier for the job?" >&2
    exit 1
  fi
  eval "${_so}"
  unset _so _sp
  echo "secrets: loaded fnox profile(s): $*"
}

# secret <NAME> <profile> — print one secret (pipe it straight into the consumer).
secret() {
  _secrets_require_identity
  fnox get --no-defaults --if-missing error -P "$2" "$1"
}

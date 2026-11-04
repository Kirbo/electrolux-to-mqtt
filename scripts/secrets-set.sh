#!/bin/sh
# secrets-set.sh <profile> <NAME> — encrypt one secret into fnox.toml with the provider
# that profile's readers need. The value is read from stdin (pipe it; never pass it as an
# argument), or fnox prompts for it on a terminal.
#
#   profile    provider     who can read it (docs/SECRETS.md)
#   read       age_read     maintainer, ci-read, ci-publish
#   publish    age_publish  maintainer, ci-publish
#   deploy     age_deploy   maintainer, ci-deploy
#   telemetry  age_deploy   maintainer, ci-deploy
#   sonar      age_sonar    maintainer, ci-sonar
#   renovate   age_renovate maintainer, ci-renovate
set -eu

[ $# -eq 2 ] || { echo "Usage: $0 read|publish|deploy|telemetry|sonar|renovate NAME  (value on stdin)" >&2; exit 1; }
case "$1" in
  read) provider=age_read ;;
  publish) provider=age_publish ;;
  deploy | telemetry) provider=age_deploy ;;
  sonar) provider=age_sonar ;;
  renovate) provider=age_renovate ;;
  *) echo "Unknown profile '$1'" >&2; exit 1 ;;
esac
cd "$(dirname "$0")/.."
fnox set --no-defaults -P "$1" "$2" --provider "${provider}"

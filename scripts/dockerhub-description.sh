#!/bin/sh
# dockerhub-description.sh — set README_FILEPATH as the Docker Hub "full description" of
# DOCKERHUB_REPOSITORY (what peterevans/dockerhub-description did, minus its image, so the
# job can take its password from fnox).
#
# The password (or PAT) is read from STDIN; neither it nor the session token ever appears
# in a process argv. Needs curl + jq.
#
# Usage: <password> | DOCKERHUB_USERNAME=… DOCKERHUB_REPOSITORY=ns/repo README_FILEPATH=… sh scripts/dockerhub-description.sh
set -eu

: "${DOCKERHUB_USERNAME:?}" "${DOCKERHUB_REPOSITORY:?}" "${README_FILEPATH:?}"
[ -f "${README_FILEPATH}" ] || { echo "dockerhub-description: ${README_FILEPATH} not found" >&2; exit 1; }

API="https://hub.docker.com/v2"
DH_PASSWORD=$(cat)
[ -n "${DH_PASSWORD}" ] || { echo "dockerhub-description: empty password on stdin" >&2; exit 1; }

token=$(DH_PASSWORD="${DH_PASSWORD}" jq -n '{username: env.DOCKERHUB_USERNAME, password: env.DH_PASSWORD}' |
  curl -fsS -H 'Content-Type: application/json' --data @- "${API}/users/login" | jq -r '.token // empty')
unset DH_PASSWORD
[ -n "${token}" ] || { echo "dockerhub-description: Docker Hub login returned no token" >&2; exit 1; }

# Auth header from a 0600 file (curl -H @file), so the token stays out of argv.
hdr=$(mktemp)
trap 'rm -f "${hdr}"' EXIT
printf 'Authorization: JWT %s\n' "${token}" >"${hdr}"
unset token

jq -n --rawfile d "${README_FILEPATH}" '{full_description: $d}' |
  curl -fsS -X PATCH -H @"${hdr}" -H 'Content-Type: application/json' --data @- \
    "${API}/repositories/${DOCKERHUB_REPOSITORY}/" >/dev/null
echo "dockerhub-description: updated ${DOCKERHUB_REPOSITORY}"

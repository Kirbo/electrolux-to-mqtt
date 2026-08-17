#!/bin/sh
# create-gitlab-release.sh — create the GitLab release (and its tag, from
# CI_COMMIT_SHA) via the Releases API — no go-semantic-release. The description
# is the changelog produced by the generate-release-notes job. Shared by the
# "create gitlab release" (main) and "create gitlab prerelease" (next) jobs,
# which previously duplicated this block verbatim.
#
# Inputs (env): CI_JOB_TOKEN, CI_API_V4_URL, CI_PROJECT_ID, CI_COMMIT_SHA;
#   VERSION from build.env; UNRELEASED-CHANGELOG.md in the workdir.
# Requires: curl, jq.
set -eu

. ./build.env
TAG="v${VERSION}"

HTTP_STATUS=$(curl --silent --output /tmp/release_response.json --write-out "%{http_code}" \
  --request POST \
  --header "JOB-TOKEN: ${CI_JOB_TOKEN}" \
  --header "Content-Type: application/json" \
  --data "$(jq -n \
    --arg name "${TAG}" \
    --arg tag_name "${TAG}" \
    --arg ref "${CI_COMMIT_SHA}" \
    --rawfile description UNRELEASED-CHANGELOG.md \
    '{name: $name, tag_name: $tag_name, ref: $ref, description: $description}')" \
  "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/releases")

if [ "${HTTP_STATUS}" = "201" ]; then
  echo "Release ${TAG} created"
elif [ "${HTTP_STATUS}" = "409" ]; then
  echo "Release ${TAG} already exists, skipping"
else
  echo "Failed to create release (HTTP ${HTTP_STATUS}):"
  cat /tmp/release_response.json
  exit 1
fi

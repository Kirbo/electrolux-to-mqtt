#!/bin/sh
# docker-buildx-release.sh — one buildx invocation for the three CI image jobs,
# which previously carried near-identical inline blocks. Mode picks the tags,
# the push behavior, and the baked-in UPDATE_CHANNEL:
#
#   try     "try to build docker images" (branch pipelines): no push, no channel,
#           local :latest tag only — proves the multi-arch build works.
#   stable  "build and deploy docker images" (main): push :${VERSION} + :latest
#           with UPDATE_CHANNEL=stable.
#   beta    "build and deploy beta docker images" (main + next): push :next with
#           UPDATE_CHANNEL=beta; on the next branch ALSO push :${VERSION} as the
#           immutable beta pin. On main, :next only — the :${VERSION} and :latest
#           tags belong to the stable job, so this beta-channel digest must not
#           clobber them.
#
# :latest and :next are SEPARATE images with different UPDATE_CHANNEL build args
# (stable/beta) so the version-checker's default channel is always baked in
# regardless of the running version number — a :next image carrying a
# promoted-stable version (e.g. 2026.6.4, no bN) would previously derive
# 'stable' from the version string; now it always gets 'beta' from the image.
#
# Inputs (env): BUILDER_NAME, NODE_VERSION, CI_COMMIT_SHORT_SHA, CI_COMMIT_BRANCH,
#   DOCKER_REGISTRY, DOCKERHUB_REPOSITORY; VERSION from build.env.
set -eu

MODE="${1:?usage: docker-buildx-release.sh try|stable|beta}"

. ./build.env

CHANNEL_ARGS=""
PUSH_ARGS=""
case "${MODE}" in
  try)
    # Local-only smoke tag; never pushed, so no registry prefix.
    TAGS="-t kirbownz/electrolux-to-mqtt:latest"
    ;;
  stable)
    CHANNEL_ARGS="--build-arg UPDATE_CHANNEL=stable"
    PUSH_ARGS="--push --provenance=true --sbom=true"
    TAGS="-t ${DOCKER_REGISTRY}/${DOCKERHUB_REPOSITORY}:${VERSION} -t ${DOCKER_REGISTRY}/${DOCKERHUB_REPOSITORY}:latest"
    ;;
  beta)
    CHANNEL_ARGS="--build-arg UPDATE_CHANNEL=beta"
    PUSH_ARGS="--push --provenance=true --sbom=true"
    TAGS="-t ${DOCKER_REGISTRY}/${DOCKERHUB_REPOSITORY}:next"
    if [ "${CI_COMMIT_BRANCH:-}" = "next" ]; then
      TAGS="${TAGS} -t ${DOCKER_REGISTRY}/${DOCKERHUB_REPOSITORY}:${VERSION}"
    fi
    ;;
  *)
    echo "ERROR: unknown mode '${MODE}' (expected try|stable|beta)" >&2
    exit 1
    ;;
esac

# ${CHANNEL_ARGS} / ${PUSH_ARGS} / ${TAGS} are intentionally unquoted — they are
# word lists of flags, empty in some modes.
# shellcheck disable=SC2086
docker buildx build \
  --builder "${BUILDER_NAME}" \
  --build-arg NODE_VERSION=${NODE_VERSION} \
  --build-arg VERSION=${VERSION} \
  --build-arg BUILD_DATE=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
  --build-arg VCS_REF=${CI_COMMIT_SHORT_SHA} \
  ${CHANNEL_ARGS} \
  ${PUSH_ARGS} \
  --platform linux/amd64,linux/arm64 \
  ${TAGS} \
  -f docker/Dockerfile .

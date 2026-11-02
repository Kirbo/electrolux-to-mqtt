#!/bin/sh
# backend-up.sh [-d] — build the telemetry-backend image, then (re)start it with compose.
#
# The image is built with plain `docker build --network host`, NOT `docker compose up
# --build`: the build needs host networking (BuildKit's own network namespace cannot
# reach registry.npmjs.org on the server), and Compose ≥ 5 always builds through
# Bake, which refuses a host-network build because Compose grants Bake only
# `--allow fs.read` ("pass --allow=network.host"). So the compose file only RUNS the
# image (image: telemetry-backend:local, pull_policy: never) and this script is the
# single way to build it — used by `pnpm backend:docker` and the CI deploy job.
#
# Versions come from versions.env (build-args of the same names). Secrets come from
# telemetry-backend/.env (`pnpm secrets:env` locally; the deploy job writes the
# server's). -d runs detached (deploy); without it compose stays in the foreground.
set -eu

cd "$(dirname "$0")/.."
set -a
# shellcheck source=/dev/null
. ./versions.env
set +a

docker build --network host -f telemetry-backend/Dockerfile \
  --build-arg NODE_MAJOR --build-arg ALPINE_VERSION --build-arg COREPACK_VERSION \
  -t telemetry-backend:local .

if [ "${1:-}" = "-d" ]; then
  docker compose -f telemetry-backend/docker-compose.yml up -d
else
  docker compose -f telemetry-backend/docker-compose.yml up
fi

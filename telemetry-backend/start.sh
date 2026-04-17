#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(git rev-parse --show-toplevel)

echo "Setting up Node.js version from .nvmrc"
NODE_VERSION=$(cat "${ROOT_DIR}/.nvmrc")
export NODE_VERSION
echo "Using Node.js version: ${NODE_VERSION}"

echo "Going to telemetry-backend directory"
cd "${ROOT_DIR}/telemetry-backend" || exit 1

echo "Running Docker Compose down and up --build as detached"
docker compose down
docker compose up --build -d

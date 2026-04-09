#!/usr/bin/env bash

set -e

git fetch origin main

CHANGES=$(git diff HEAD origin/main -- telemetry-backend/)

if [[ -z "${CHANGES}" ]]; then
  echo "Already up-to-date, no changes in telemetry-backend/"
  exit 0
fi

echo "Changes detected in telemetry-backend/, redeploying..."
git pull origin main

echo "Setting up Node.js version from .nvmrc"
NODE_VERSION=$(cat .nvmrc)
export NODE_VERSION
echo "Using Node.js version: ${NODE_VERSION}"

echo "Going to telemetry-backend directory"
cd telemetry-backend

echo "Running Docker Compose down and up --build as detached"
docker compose down
docker compose up --build -d

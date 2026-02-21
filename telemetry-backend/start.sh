#!/usr/bin/env bash

set -e

git fetch origin main

CHANGES=$(git diff HEAD origin/main -- telemetry-backend/)

if [ -z "$CHANGES" ]; then
  echo "Already up-to-date, no changes in telemetry-backend/"
  exit 0
fi

echo "Changes detected in telemetry-backend/, redeploying..."

git pull origin main

docker compose -f telemetry-backend/docker-compose.yml down

NODE_VERSION=$(cat .nvmrc) docker compose -f telemetry-backend/docker-compose.yml up --build -d

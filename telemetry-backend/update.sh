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

./start.sh

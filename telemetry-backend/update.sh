#!/usr/bin/env bash

set -e

ROOT_DIR=$(git rev-parse --show-toplevel)

cd "${ROOT_DIR}"

git fetch origin main

CHANGES=$(git diff HEAD origin/main -- telemetry-backend/)

if [[ -z "${CHANGES}" ]]; then
  echo "Already up-to-date, no changes in telemetry-backend/"
  exit 0
fi

echo "Changes detected in telemetry-backend/, redeploying..."
git pull origin main

"${ROOT_DIR}/telemetry-backend/start.sh"

#!/usr/bin/env bash

set -euo pipefail

BRANCH="${1:-main}"

ROOT_DIR=$(git rev-parse --show-toplevel)
cd "${ROOT_DIR}"

BEFORE=$(git rev-parse HEAD)

git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull origin "${BRANCH}"

AFTER=$(git rev-parse HEAD)

if [[ "${BEFORE}" == "${AFTER}" ]]; then
  echo "Already up-to-date, nothing to do"
  exit 0
fi

CHANGES=$(git diff "${BEFORE}" "${AFTER}" -- telemetry-backend/)

if [[ -z "${CHANGES}" ]]; then
  echo "Pulled ${BRANCH} (${BEFORE:0:7}→${AFTER:0:7}) but no telemetry-backend changes, skip rebuild"
  exit 0
fi

echo "Changes in telemetry-backend/ detected (${BEFORE:0:7}→${AFTER:0:7}), redeploying..."
"${ROOT_DIR}/telemetry-backend/start.sh"

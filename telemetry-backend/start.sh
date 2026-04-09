#!/usr/bin/env bash

set -e

echo "Setting up Node.js version from .nvmrc"
NODE_VERSION=$(cat .nvmrc)
export NODE_VERSION
echo "Using Node.js version: ${NODE_VERSION}"

echo "Going to telemetry-backend directory"
cd telemetry-backend

echo "Running Docker Compose down and up --build as detached"
docker compose down
docker compose up --build -d

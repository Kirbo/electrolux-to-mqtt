#!/usr/bin/env bash

docker compose -f telemetry-backend/docker-compose.yml down

git pull origin main

NODE_VERSION=$(cat .nvmrc) docker compose -f telemetry-backend/docker-compose.yml up --build -d

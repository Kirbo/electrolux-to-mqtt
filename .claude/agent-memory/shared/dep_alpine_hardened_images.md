---
name: dep-alpine-hardened-images
description: Hardened dhi.io/node image tags — Node 24 latest is 24-alpine3.24 (checked June 2026)
metadata:
  type: project
---

The prod Dockerfile at `/home/kirbo/Projects/electrolux-to-mqtt/docker/Dockerfile` uses hardened `dhi.io/node` images.

Catalog URL: https://hub.docker.com/hardened-images/catalog/dhi/node/images

As of June 2026, the latest Node 24 standard tag is `24-alpine3.24` (resolves to Node 24.17.0, Alpine 3.24). The catalog has 54 images total (as of June 2026, down from 102) — browse page 2 to find Node 24 Alpine tags since page order is newest-first (page 1 shows Node 26, page 5 shows Node 22).

Tag format for prod: `24-alpine3.XX` (non-dev, non-fips, non-sfw).

**Why:** catalog is paginated; Node 24 appears on page 2 as of June 2026.

**How to apply:** When Alpine bumps, update `ARG NODE_VERSION=24-alpineX.XX` in `docker/Dockerfile` AND the `echo "NODE_VERSION=$(cat .nvmrc)-alpineX.XX"` line in `.gitlab/ci/01_init.yml`. Telemetry-backend uses standard node:alpine, not hardened images — no change needed there.

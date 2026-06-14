---
name: dep-alpine-hardened-images
description: Hardened dhi.io/node image tags — Node 24 latest is 24-alpine3.24 (checked June 2026)
metadata:
  type: project
---

The prod Dockerfile at `/home/kirbo/Projects/electrolux-to-mqtt/docker/Dockerfile` uses hardened `dhi.io/node` images.

Catalog URL: https://hub.docker.com/hardened-images/catalog/dhi/node/images

As of June 2026, the latest Node 24 standard tag is `24-alpine3.24` (resolves to Node 24.16.0, Alpine 3.24). The catalog has 102 images total — browse pages 5-6 to find Node 24 tags since page order is newest-first.

Tag format for prod: `24-alpine3.XX` (non-dev, non-fips, non-sfw).

**Why:** catalog is paginated; Node 24 starts appearing around page 5-6 of 102.

**How to apply:** When Alpine bumps, update `ARG NODE_VERSION=24-alpineX.XX` in `docker/Dockerfile` only (telemetry-backend uses standard node:alpine, not hardened images).

---
name: dep-alpine-hardened-images
description: Hardened dhi.io/node image tags — prod is 26-alpine3.24 since 2026-11-02; catalog 54 rows, 10 per page, ?page=N; no Alpine 3.25 yet
metadata: 
  node_type: memory
  type: project
  originSessionId: e47e8080-7ddc-47fb-af08-acb5e9a74409
  modified: 2026-07-24T18:32:30.212Z
---

The prod Dockerfile at `/home/kirbo/Projects/electrolux-to-mqtt/docker/Dockerfile` uses hardened `dhi.io/node` images.

Catalog URL: https://hub.docker.com/hardened-images/catalog/dhi/node/images

As of June 2026, the latest Node 24 standard tag is `24-alpine3.24` (resolves to Node 24.17.0, Alpine 3.24). The catalog has 54 images total (as of June 2026, down from 102) — browse page 2 to find Node 24 Alpine tags since page order is newest-first (page 1 shows Node 26, page 5 shows Node 22).

Rechecked 2026-07-24: catalog page 1 now leads with Node 26 on Alpine 3.24/3.23. Node 26 is not LTS yet (LTS promotion ~Oct 2026); Alpine 3.24 is still the newest Alpine. `24-alpine3.24` remains the correct prod tag — no change. Revisit after Node 26 LTS + Alpine 3.25 (~Nov 2026).

Rechecked 2026-11-02 (Node 26 bump): `26-alpine3.24` and `26-alpine3.24-dev` exist; Node 26 also offered on 3.23; still no Alpine 3.25. Prod now builds `26-alpine3.24`.

Tag format for prod: `24-alpine3.XX` (non-dev, non-fips, non-sfw).

**Why:** catalog is paginated; Node 24 appears on page 2 as of June 2026.

**How to apply:** When Alpine bumps, update root `package.json` `alpineVersion` (moved out of `mise.toml` 2026-10-05 so an Alpine-only bump hits the release gate) — CI (`.gitlab/ci/01_init.yml`) combines it with the `engines.node` major into NODE_VERSION, and `docker/Dockerfile` has no default (NODE_VERSION build-arg comes from CI/mise). Since 2026-10-05 `Dockerfile.local` and `telemetry-backend/Dockerfile` (stock `node` images) are pinned to the same `alpineVersion` via a required `ALPINE_VERSION` build-arg, so a bump needs the `<major>-alpine<ver>` tag to exist on BOTH dhi.io and Docker Hub `node`.

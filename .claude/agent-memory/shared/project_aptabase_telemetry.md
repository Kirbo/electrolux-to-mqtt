---
name: project-aptabase-telemetry
description: Telemetry moved to self-hosted Aptabase; one telemetry-backend serves badges + forwards legacy POSTs
metadata: 
  node_type: memory
  type: project
  originSessionId: 98905752-6fe7-4789-adc0-1ffdffd4ca26
---

Telemetry migration (done in working tree 2026-06-26, pending deploy + commit rework):

- **Bridge → Aptabase directly**: `src/version-checker.ts` POSTs a `version_check` event to self-hosted Aptabase `https://aptabase.devaus.eu/api/v0/events` (header `App-Key: A-SH-2414786682`, hardcoded). Event built in `src/telemetry.ts`: app version, channel, OS name/version + arch, appliance model(s)+count. Opt-out unchanged (`E2M_TELEMETRY_ENABLED`). HMAC `userHash`/salt gone.
- **Old Express+Redis `telemetry-backend/` replaced by a NEW single Aptabase-backed `telemetry-backend/`** — one long-running Node `http` service (no Redis, no Express), combining two roles:
  1. **Badge serving (permanent)**: regenerates `users.svg`/`stable.svg`/`beta.svg`/`telemetry.json` **in memory** every `BADGE_INTERVAL_SECONDS` (300) from Aptabase **ClickHouse** (`ClickHouseLike` + `aggregateTelemetry`, filtered by the app **GUID** `APTABASE_APP_ID`) + GitLab releases; serves them over HTTP. No disk volume.
  2. **Legacy ingest (temporary)**: `POST /telemetry` accepts OLD bridges' `{userHash,version,channel}`, forwards to Aptabase as a `version_check` event tagged `props.source='legacy'`, preserving client IP via `X-Forwarded-For`. **Remove this half + the deletion-checklist once `source='legacy'` traffic ≈ 0.**
- **App-Key vs app_id**: bridge ingests with the App-Key; the badge reader filters ClickHouse on the app **GUID** (`APTABASE_APP_ID`) — different values.
- **Port 3002** (avoids the old backend's 3001 during cutover). Published on the host so **Nginx Proxy Manager** (`nginxproxymanager-app-1`, a container — can't reach host loopback) can proxy `e2m.devaus.eu` → the service for everything (badges + `/telemetry`), like the old backend on 3001.
- ClickHouse at `http://aptabase_events_db:8123` on the shared `aptabase_default` network (Aptabase stack at `/home/kirbo/Projects/aptabase`; services `aptabase_app`/`aptabase_db`/`aptabase_events_db`). CH creds are secret → SOPS `telemetry-backend/.env.enc` (`env_file`); CI `deploy telemetry-backend` decrypts in-runner via the **`SOPS_AGE_KEY`** CI var (set ✓) using a **mise-pinned PQ sops** and scp's `.env`. `APTABASE_HOST`/`APTABASE_APP_KEY` are non-secret (compose inline).
- Tool versions (node/alpine/sops/age) single-sourced in `mise.toml` → `pnpm sync:versions`; CI `versions in sync` guards drift. See [[project_sops_secrets]].

**Module map (`telemetry-backend/src/`)** — the merge of the old `badge-cron/` + `telemetry-shim/` into one service (2026-06-26):
- `badge-store.ts` — in-memory SVG store; `BadgeStore` interface + `createBadgeStore()` factory.
- `server.ts` — Node `http.Server`; routes `/health`, `/`, `/users.svg`, `/stable.svg`, `/beta.svg`, `/telemetry.json`, `POST /telemetry`.
- `index.ts` — wires config, ClickHouse, badge store, forwarder, rate limiter, `setInterval` regeneration, SIGTERM/SIGINT shutdown.
- `config.ts` — `BackendConfig`; PORT 3002 default; two required: `CLICKHOUSE_URL`, `APTABASE_APP_ID`.
- `aptabase.ts` — `serviceVersion`; sdkVersion `telemetry-backend@${version}`.
- Tests: 9 files (~152) covering badge-store, server, config, aptabase, clickhouse, badges, rate-limit, version-check, plus the `FakeClickHouse` helper.

**PREREQUISITE for legacy counting**: Aptabase must trust the forwarded client IP (`X-Forwarded-For`), else all legacy installs collapse to one user — the same proxy-trust direct bridges rely on.

**Accepted trade-off**: "active users" is now Aptabase distinct (IP+UA) per UTC day (under-counts behind shared IPs) vs the old stable-hash install count — the badge number shifts when live. Reader uses a calendar-UTC-day window.

**Pending human deploy steps**: get `APTABASE_APP_ID` (GUID from Aptabase Postgres `apps`), confirm `CLICKHOUSE_DATABASE`, create the read-only `badge_reader` CH user, confirm the docker network name; fill `telemetry-backend/.env` → `pnpm sops:encrypt` → commit `telemetry-backend/.env.enc` (the old `badge-cron/.env.enc` was deleted in the merge — re-encrypt under the new path); point NPM `e2m.devaus.eu` → `telemetry-backend:3002`; stop the old `telemetry-backend`+`telemetry-redis` containers at cutover.

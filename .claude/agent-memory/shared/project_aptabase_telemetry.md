---
name: project-aptabase-telemetry
description: Telemetry on self-hosted Aptabase; telemetry-backend writes badge SVGs to disk (nginx serves them) + forwards legacy POSTs
metadata: 
  node_type: memory
  type: project
  originSessionId: 98905752-6fe7-4789-adc0-1ffdffd4ca26
  modified: 2026-08-04T12:22:57.939Z
---

Telemetry architecture (migrated 2026-06-26; badge serving refactored to static files in commit 726ceee; verified against code 2026-08-04):

- **Bridge → Aptabase directly**: `src/version-checker.ts` POSTs a `version_check` event to self-hosted Aptabase `https://aptabase.devaus.eu/api/v0/events` (header `App-Key: A-SH-2414786682`, hardcoded). Event built in `src/telemetry.ts`: app version, channel, OS name/version + arch, appliance model(s)+count, stable sessionId = sha256(username) as GUID (see [[project-steady-user-count]]). Opt-out unchanged (`E2M_TELEMETRY_ENABLED`).
- **`telemetry-backend/`** — one long-running Node `http` service (no Redis, no Express), two roles:
  1. **Badge generation (permanent)**: every `BADGE_INTERVAL_SECONDS` (300) `badge-store.ts` reads Aptabase **ClickHouse** (`ClickHouseLike` + `aggregateTelemetry`, filtered by app **GUID** `APTABASE_APP_ID`, rolling 26h `session_id` window) + GitLab releases, and **writes `users.svg`/`stable.svg`/`beta.svg`/`telemetry.json` to `OUTPUT_DIR` (`/app/badge` volume) — the reverse proxy (nginx) serves those statically; badge GETs never hit the container.** Only the telemetry JSON and latest release tags are held in memory for the HTTP routes.
  2. **Legacy ingest (temporary)**: `POST /telemetry` accepts OLD bridges' `{userHash,version,channel}`, forwards to Aptabase as `version_check` tagged `props.source='legacy'`. **Remove this half once `source='legacy'` traffic ≈ 0** (check ClickHouse; `/telemetry.json` doesn't show the split).
- **HTTP routes (server.ts)**: `GET/HEAD /health`; `GET /telemetry` → in-memory aggregated JSON (503 until first successful cycle); `POST /telemetry` → legacy ingest (rate-limit → validate → 204 → forward); `GET /stable` / `GET /beta` → **302 redirect to the latest release page** (fail-open to the releases list); everything else 404. `GET / → 302 /users.svg` is a reverse-proxy rule, not a route.
- `regenerate-badges.ts` — one-shot regeneration run by CI after a release (`refresh telemetry badges` job) so badges update immediately; fails loudly if either half fails.
- **App-Key vs app_id**: bridge ingests with the App-Key; the badge reader filters ClickHouse on the app **GUID** (`APTABASE_APP_ID`) — different values.
- `config.ts` default PORT **3001**; compose publishes it for **Nginx Proxy Manager** (a container — can't reach host loopback) to proxy `e2m.devaus.eu`.
- ClickHouse at `http://aptabase_events_db:8123` on the shared `aptabase_default` network. CH creds are secret → SOPS `telemetry-backend/.env.enc` (`env_file`); CI decrypts via the `SOPS_AGE_KEY` CI var (mise-pinned PQ sops). `APTABASE_HOST`/`APTABASE_APP_KEY` are non-secret (compose inline). See [[project_sops_secrets]].
- `telemetry-backend/docker-compose.yml` `build.network: host` is REQUIRED (BuildKit netns can't reach registry.npmjs.org).

**Deployed and live** (e2m.devaus.eu/telemetry.json serving real data as of 2026-08-04).

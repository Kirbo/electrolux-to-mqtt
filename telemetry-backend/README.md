# telemetry-backend

Aptabase-backed HTTP service that serves the README badges and forwards legacy telemetry POSTs to Aptabase. Replaces the previous Express + Redis telemetry backend.

A near drop-in for the old telemetry backend — same routes and port (3001) — but Aptabase-backed.

## What it does

1. **Badge generation (permanent)** — on startup and every `BADGE_INTERVAL_SECONDS` (default 300 s), reads aggregated usage data from Aptabase's ClickHouse and fetches the latest GitLab releases, then **writes** the artifacts to `OUTPUT_DIR` (a mounted volume). The reverse proxy serves these **statically**, so the high-traffic badge GETs never hit the container:
   - `users.svg` — users-today badge
   - `peak-24h.svg`, `peak-7d.svg`, `peak-30d.svg`, `peak-182d.svg`, `peak-365d.svg` — trailing-window peak badges (invisible SVG until a sample exists; the root README embeds `30d` + `365d`)
   - `stable.svg` — latest stable release badge
   - `beta.svg` — latest beta release badge (invisible SVG if beta is not newer than stable)
   - `telemetry.json` — raw aggregated telemetry (total + channels + per-version breakdown + trailing-window peaks)
   - `peaks-history.json` — persisted hourly-max samples of the user count that the peaks are computed from (see below)

2. **Dynamic endpoints (served by the container)** — everything the old backend exposed dynamically:
   - `GET /telemetry` — the aggregated JSON incl. `peaks` (also written to disk as `telemetry.json`)
   - `GET /stable` / `GET /beta` — 302 redirect to the latest release (fail-open to the releases page)
   - `GET /health` — 200 `{ status: 'ok' }`
   - `POST /telemetry` — **legacy ingest**: old bridge versions POST `{ userHash, version, channel }`; the service rate-limits, validates, and forwards to Aptabase as a `version_check` event tagged `source='legacy'` (204, best-effort). The `userHash` is mapped to a UUID-shaped `sessionId` because **Aptabase silently drops events whose `sessionId` is not GUID-parseable** (200 response, no row written). *Temporary* — see the delete checklist.

   `GET /` → `302 /users.svg` is handled by the reverse proxy.

### Delete checklist for the legacy half

When `source='legacy'` events in Aptabase drop to ~0 (no more old bridges in the wild), remove:

- `POST /telemetry` route from `src/server.ts`
- `src/aptabase.ts`, `src/validation.ts`, `src/ip.ts`, `src/rate-limit.ts`
- Corresponding tests
- `APTABASE_HOST`, `APTABASE_APP_KEY`, `RATE_LIMIT_*` config fields and env from docker-compose

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CLICKHOUSE_URL` | Yes | — | ClickHouse HTTP endpoint (via Aptabase docker network) |
| `CLICKHOUSE_USER` | No | `default` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | No | `""` | ClickHouse password |
| `CLICKHOUSE_DATABASE` | No | `default` | ClickHouse database |
| `APTABASE_APP_ID` | Yes | — | Aptabase app GUID (from dashboard / `apps` Postgres table) |
| `BADGE_INTERVAL_SECONDS` | No | `300` | Seconds between badge regeneration cycles |
| `OUTPUT_DIR` | No | `/app/badge` | Dir the badge files are written to (mounted volume, served static by nginx) |
| `RELEASES_API_URL` | No | GitLab API | GitLab releases API URL |
| `RELEASES_PAGE_URL` | No | GitLab page | GitLab releases page URL |
| `APTABASE_HOST` | No | `https://aptabase.devaus.eu` | Aptabase ingestion host |
| `APTABASE_APP_KEY` | No | `A-SH-2414786682` | Aptabase App-Key for forwarding |
| `RATE_LIMIT_REQUESTS` | No | `10` | Max requests per IP per window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in ms |
| `PORT` | No | `3001` | HTTP listen port (matches the old backend, so the proxy target is unchanged) |

**SOPS-managed secrets** (put in `telemetry-backend/.env`, encrypted as `.env.enc`):
`CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `APTABASE_APP_ID`

**Non-secret** (live in `docker-compose.yml` environment block):
`APTABASE_HOST`, `APTABASE_APP_KEY`, `PORT`, `OUTPUT_DIR`, `BADGE_INTERVAL_SECONDS`, `RATE_LIMIT_*`

## Reverse proxy wiring

The badge SVGs (+ `telemetry.json`) are served **statically** from the `OUTPUT_DIR` volume; only the dynamic routes (`/telemetry`, `/stable`, `/beta`, `/health`) are proxied to the service on **:3001** (the old backend's port — so an existing proxy config barely changes). See `nginx/reverse-proxy.conf` for a host-nginx reference (static `root` + proxied dynamic locations).

With **Nginx Proxy Manager** (a container that can't reach the host's `127.0.0.1`): serve the badge dir statically and forward the dynamic locations to the **host IP**`:3001`, or attach the service to NPM's network and use `http://telemetry-backend:3001`.

## How the user count works

The "users" count is `uniqExact(session_id)` over a **rolling 26h window** (`USER_WINDOW_HOURS`
in `clickhouse.ts`), **not** Aptabase's `user_id`:

- **`session_id`, not `user_id`** — Aptabase's `user_id` is a daily hash of `app_id + client IP
  + User-Agent` that **rotates at UTC midnight**, so it can't be counted across the boundary.
  `session_id` is a stable per-install id (derived from `sha256(electrolux username)`, identical
  on the bridge's direct path and on the legacy forwarder), so it survives midnight and restarts.
- **Rolling 26h, not `toStartOfDay`** — a fixed-width trailing window keeps the count steady around
  the clock instead of resetting at midnight and ramping up. 26h = the version-checker's 24h max
  poll interval + 2h slack, so every install that pinged at least once is always inside it. The
  bridge also pings telemetry every 15 min (decoupled from the version-check interval), so a steady
  cadence keeps the window full. *Once legacy traffic →0 and the legacy ingest half is removed, the
  window can shrink to ~1h (4× the 15-min ping) for a tighter, more live count.*
- **`stable`/`beta` are distinct counts** from a dedicated `GROUP BY channel` query — not the
  over-counting sum of the per-version rows.

### Peak user counts

Aptabase only yields the *current* rolling-26h count, so the historical peaks are built by
the service itself (`peaks.ts`): every badge cycle the `total` is sampled and folded into
**hourly max buckets**, persisted as `peaks-history.json` in `OUTPUT_DIR` (the same mounted
volume as the badges — so restarts and redeploys keep the history). Buckets older than
365 days + 1 hour are trimmed, which caps the file at ~8.8k entries.

`telemetry.json` / `GET /telemetry` expose them as `peaks`, one entry per trailing window
(`null` until at least one sample exists):

| Key | Window |
|---|---|
| `24h` | last 24 hours |
| `7d` | last week |
| `30d` | last ~1 month |
| `182d` | last ~6 months |
| `365d` | last ~12 months |

```json
"peaks": { "24h": { "value": 42, "at": "2026-09-15T12:00:00.000Z" }, "7d": { … }, … }
```

Each window is also rendered as a `peak-<key>.svg` badge (`peak 30d | 57`). `at` is the start of the hour bucket the peak was seen in. A bucket counts toward a window
when any part of it overlaps the window. History only accumulates from the first deploy of
this feature — there is no backfill from ClickHouse. A corrupt or unreadable history file is
logged and replaced by a fresh one rather than blocking the cycle. The one-shot
`regenerate-badges.ts` (CI, after a release) samples too; the long-running server's in-memory
history is a superset, so its next write is authoritative.

### Per-install identity & GeoIP

Aptabase's `user_id` (used by Aptabase's own dashboard, not this badge) shares one client IP for all
forwarded legacy events (the backend container — the proxy chain doesn't honor the `X-Forwarded-For`
this service sends). The forwarder still sets a per-install `User-Agent`
(`electrolux-to-mqtt-legacy/<sessionId>`) so Aptabase's own counts don't collapse, and still sends
`X-Forwarded-For`. If you fix the openresty→Aptabase chain to trust it (e.g.
`ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` with the proxy hops as known networks), GeoIP
(`country_code`/`region_name`) is restored — but this badge's count doesn't depend on it.

## Development

```bash
cd telemetry-backend
pnpm install
pnpm dev          # tsx watch src/index.ts (requires .env with CH creds)
pnpm typecheck
pnpm test
```

## Docker

```bash
# From repo root
pnpm backend:docker   # docker compose down + up --build
```

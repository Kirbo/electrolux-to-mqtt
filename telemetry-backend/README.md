# telemetry-backend

Aptabase-backed HTTP service that serves the README badges and forwards legacy telemetry POSTs to Aptabase. Replaces the previous Express + Redis telemetry backend.

A near drop-in for the old telemetry backend — same routes and port (3001) — but Aptabase-backed.

## What it does

1. **Badge generation (permanent)** — on startup and every `BADGE_INTERVAL_SECONDS` (default 300 s), reads aggregated usage data from Aptabase's ClickHouse and fetches the latest GitLab releases, then **writes** the artifacts to `OUTPUT_DIR` (a mounted volume). The reverse proxy serves these **statically**, so the high-traffic badge GETs never hit the container:
   - `users.svg` — users-today badge
   - `stable.svg` — latest stable release badge
   - `beta.svg` — latest beta release badge (invisible SVG if beta is not newer than stable)
   - `telemetry.json` — raw aggregated telemetry (total + channels + per-version breakdown)

2. **Dynamic endpoints (served by the container)** — everything the old backend exposed dynamically:
   - `GET /telemetry` — the aggregated JSON (also written to disk as `telemetry.json`)
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

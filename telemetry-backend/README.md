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
   - `POST /telemetry` — **legacy ingest**: old bridge versions POST `{ userHash, version, channel }`; the service rate-limits, validates, and forwards to Aptabase as a `version_check` event tagged `source='legacy'` (204, best-effort). *Temporary* — see the delete checklist.

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

## Aptabase X-Forwarded-For trust (legacy ingest prerequisite)

For `source='legacy'` events to be counted per bridge install (not per backend IP), Aptabase must trust and use the `X-Forwarded-For` header that this service sends. Verify this is enabled in your Aptabase configuration before deploying the legacy ingest path.

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

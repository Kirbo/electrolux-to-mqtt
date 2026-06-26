# telemetry-backend

Combined Aptabase-backed HTTP service that replaces the separate `badge-cron` + `telemetry-shim` containers.

## What it does

1. **Badge serving (permanent)** — on startup and every `BADGE_INTERVAL_SECONDS` (default 300 s), reads aggregated usage data from Aptabase's ClickHouse and fetches the latest GitLab releases, then renders four in-memory artifacts:
   - `GET /users.svg` — users-today badge
   - `GET /stable.svg` — latest stable release badge
   - `GET /beta.svg` — latest beta release badge (invisible SVG if beta is not newer than stable)
   - `GET /telemetry.json` — raw aggregated telemetry (total + channels + per-version breakdown)
   - `GET /` — 302 redirect to `/users.svg`
   - `GET /health` — 200 `{ status: 'ok' }`

2. **Legacy ingest (temporary)** — old bridge versions (`<2026.6.x`) `POST /telemetry` with `{ userHash, version, channel }`. The service validates, rate-limits, and forwards to Aptabase as a `version_check` event (tagged `source='legacy'`). Responds 204 regardless of Aptabase result (best-effort).

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
| `RELEASES_API_URL` | No | GitLab API | GitLab releases API URL |
| `RELEASES_PAGE_URL` | No | GitLab page | GitLab releases page URL |
| `APTABASE_HOST` | No | `https://aptabase.devaus.eu` | Aptabase ingestion host |
| `APTABASE_APP_KEY` | No | `A-SH-2414786682` | Aptabase App-Key for forwarding |
| `RATE_LIMIT_REQUESTS` | No | `10` | Max requests per IP per window |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` | Rate limit window in ms |
| `PORT` | No | `3002` | HTTP listen port |

**SOPS-managed secrets** (put in `telemetry-backend/.env`, encrypted as `.env.enc`):
`CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `APTABASE_APP_ID`

**Non-secret** (live in `docker-compose.yml` environment block):
`APTABASE_HOST`, `APTABASE_APP_KEY`, `PORT`, `BADGE_INTERVAL_SECONDS`, `RATE_LIMIT_*`

## Nginx Proxy Manager (NPM) wiring

NPM runs in its own container and cannot reach the host's `127.0.0.1`. Two options:

- **Host IP**: proxy to `http://<host-ip>:3002` (e.g. `http://192.168.1.10:3002`)
- **Docker network**: attach this service to NPM's network and proxy to `http://telemetry-backend:3002` by service name (avoids public port exposure)

See `nginx/reverse-proxy.conf` for the reference nginx config for host-nginx deployments.

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

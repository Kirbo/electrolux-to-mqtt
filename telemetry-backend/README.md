# Electrolux-to-MQTT Telemetry Backend

Simple telemetry backend for collecting anonymous usage statistics.

## Features

- Anonymous user tracking using irreversible hashes
- Version distribution statistics
- Auto-generated usage badge
- Redis-backed storage with 24-hour TTL
- Docker Compose deployment
- Atomic rate-limiting via Redis Lua scripts
- Circuit-breaker protection around Redis rate-limit checks

## API Endpoints

### POST /telemetry
Store telemetry data for a user.

**Request:**
```json
{
  "userHash": "unique-hash-here",
  "version": "v1.6.3"
}
```

`Content-Type: application/json` is required. Requests without it receive `415 Unsupported Media Type`.

`userHash` must be exactly 64 lowercase hex characters (SHA-256 hex output). `version` must match `vX.Y.Z` or `X.Y.Z` with an optional pre-release suffix (e.g. `-rc.1`).

**Response:**
```json
{
  "success": true
}
```

### GET /telemetry
Get aggregated telemetry statistics. Versions are sorted by version descending, capped at 100 entries.

**Response:**
```json
{
  "total": 6,
  "versions": [
    {
      "version": "v1.6.3",
      "count": 2
    },
    {
      "version": "v1.6.2",
      "count": 3
    },
    {
      "version": "v1.5.0",
      "count": 1
    }
  ]
}
```

## Deployment

The telemetry backend uses the Node.js version from the root `.nvmrc` file and package manager from `package.json` to ensure version consistency across the project.

Copy `.env.example` to `.env` and fill in values before starting the stack. `RATE_LIMIT_SALT` is optional — `docker-compose.yml` mounts the host `/etc/machine-id` read-only so the backend can use it as a fallback automatically.

```bash
cd telemetry-backend
# Use NODE_VERSION from root .nvmrc (default: 24)
NODE_VERSION=$(cat ../.nvmrc) docker-compose up -d
```

Or simply (uses default NODE_VERSION=24):
```bash
cd telemetry-backend
docker-compose up -d
```

## Health endpoints

All health endpoints are exempt from rate limiting and authentication.

- `GET /health` — liveness probe. Returns `200 {"status":"ok"}` when the Express event loop is responsive. Used by the Docker `HEALTHCHECK` directive.
- `GET /health/redis` — readiness probe for the Redis dependency. Returns `200 {"redis":"ok"}` if Redis responds; `503 {"redis":"down"}` otherwise. Use this in your reverse proxy / load balancer to fail traffic over before users hit a 500.
- `GET /health/rate-limit` — circuit-breaker state. Returns `{"state":"closed"|"open"|"half-open","failures":N}`. Useful for observability dashboards and alerting on sustained Redis rate-limit check failures.

## Environment Variables

- `PORT` - Server port (default: 3001)
- `REDIS_URL` - Redis connection URL (default: redis://redis:6379)
- `RATE_LIMIT_WINDOW_MS` - Rate limit window in ms (default: 60000)
- `RATE_LIMIT_IP_MAX` - Max requests per IP per window (default: 10)
- `RATE_LIMIT_HASH_MAX` - Max requests per userHash per window (default: 1)
- `RATE_LIMIT_SALT` - Secret salt used to hash IPs for rate limiting. Optional when using `docker-compose.yml` — the host `/etc/machine-id` is mounted read-only and used automatically as fallback. Set an explicit random secret for extra security (e.g. `openssl rand -hex 32`).
- `TELEMETRY_BEHIND_PROXY` - Set to `true`/`1`/`yes` ONLY when deployed behind a trusted reverse proxy that overwrites client-supplied IP headers (Caddy, nginx, Traefik with `trustForwardHeader`, etc.). Default `false`. **Security-critical**: when `false`, the per-IP rate limiter uses the raw TCP source address (impossible to spoof). When `true`, it trusts `req.ip` (Express, populated from `X-Forwarded-For`) with `X-Real-IP` as a legacy fallback. Setting `true` without a header-rewriting proxy in front allows attackers to bypass the rate limit by rotating client headers.
- `RATE_LIMIT_BREAKER_THRESHOLD` - Number of consecutive Redis rate-limit failures before the circuit breaker opens. Default: 5. When open, `/telemetry` returns 503 until the breaker resets.
- `RATE_LIMIT_BREAKER_WINDOW_MS` - Rolling window (ms) for counting consecutive failures. Default: 60000.
- `RATE_LIMIT_BREAKER_COOLDOWN_MS` - How long the breaker stays open before transitioning to half-open for a probe request (ms). Default: 30000.
- `ALLOW_TEST_TELEMETRY` - Set to `true` to enable the `test-hash` filter (accepts payloads containing `test-hash` in `userHash` without storing). Default `false` (disabled in production). Used by integration tests.

## Security considerations

### HSTS
HTTPS Strict Transport Security is enabled (`max-age=31536000; includeSubDomains`) via Helmet. Ensure TLS is terminated at the reverse proxy before enabling HSTS.

### Atomic rate-limiting
Rate-limit counters use a Redis Lua script (`INCR` + conditional `PEXPIRE`) evaluated atomically. This eliminates the TOCTOU race in the previous non-atomic `INCR`-then-`EXPIRE` approach where concurrent requests could miss the TTL assignment.

### Circuit breaker
If Redis becomes unavailable, the rate-limit check fails open (allows requests through) until the failure count reaches `RATE_LIMIT_BREAKER_THRESHOLD` within `RATE_LIMIT_BREAKER_WINDOW_MS`. After that, the breaker opens and `/telemetry` returns `503` to protect downstream systems. After `RATE_LIMIT_BREAKER_COOLDOWN_MS`, the breaker moves to half-open and allows one probe request through to test Redis recovery. Monitor breaker state via `GET /health/rate-limit`.

### Content-Type enforcement
All `POST` requests must carry `Content-Type: application/json`. Requests without it receive `415 Unsupported Media Type` before body parsing — limiting the attack surface for content sniffing and JSON injection attacks.

### Hash validation
`userHash` must be exactly 64 hexadecimal characters (the length of a SHA-256 hex digest). Shorter, longer, or non-hex values are rejected with `400`.

### Version validation
`version` must match semver-ish format: `vX.Y.Z` or `X.Y.Z` with an optional pre-release suffix (`-alpha.1`, `-rc.2`, etc.). Arbitrary free-form strings are rejected.

## Deployment behind a reverse proxy (recommended)

For production, terminate TLS and rate-limit DDoS at a reverse proxy in front of this service. Two minimal examples:

**Caddy:**
```caddy
telemetry.example.com {
    reverse_proxy localhost:3001 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
    }
}
```
Set `TELEMETRY_BEHIND_PROXY=true` on the backend container; Caddy's `header_up` directives overwrite client-supplied values.

**nginx:**
```nginx
server {
    listen 443 ssl http2;
    server_name telemetry.example.com;
    # ... ssl_certificate / ssl_certificate_key ...

    location /badge {
        alias /path/to/telemetry-backend/badge/users.svg;
        add_header Content-Type image/svg+xml;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
The explicit `proxy_set_header X-Forwarded-For $remote_addr` (NOT `$proxy_add_x_forwarded_for`) overwrites any client-supplied chain — required so `TELEMETRY_BEHIND_PROXY=true` is safe.

If you cannot put a header-rewriting proxy in front, leave `TELEMETRY_BEHIND_PROXY=false`. The per-IP rate limit will use TCP source addresses directly; per-IP limiting still works for direct clients but you lose per-client granularity for anyone going through your own NAT/load balancer.

## Logging

This service uses `console.*` directly rather than a structured logger like pino. The choice is intentional: telemetry-backend is a tiny standalone service deployed to small VPSes or home labs, not large fleets needing structured log aggregation. If you operate this at scale and want JSON output for log aggregators, swap in pino — the surface area is small (search for `console.error` / `console.log`).

## Data Persistence

### Redis Data
Redis data is persisted using AOF (Append Only File) mode with `appendfsync everysec` (flush to disk at most once per second — the recommended durability/performance balance) and stored in a Docker volume, ensuring data survives container restarts.

### Badge Persistence
The user count badge (`badge/users.svg`) is persisted outside the Docker container in the `./badge` directory. This allows:
- Nginx to serve the badge directly without hitting the application
- Badge to remain accessible even when the Docker container is down
- The badge is regenerated on startup and on every telemetry submission (POST /telemetry)

Example Nginx configuration:
```nginx
location /badge {
    alias /path/to/telemetry-backend/badge/users.svg;
    add_header Content-Type image/svg+xml;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

## Integration tests (real Redis)

The unit tests use an in-memory `FakeRedis` that is single-threaded and cannot reproduce Redis atomicity bugs. To run integration tests against a real Redis instance:

```bash
# Start a Redis instance
docker run --rm -d -p 6379:6379 redis:7-alpine

# Run integration tests
REAL_REDIS_TEST=true pnpm test tests/integration/rate-limit.test.ts
```

The integration tests verify:
- The Lua `INCR + PEXPIRE` script sets TTL on first increment
- TTL is not reset on subsequent increments
- Concurrent increments produce a contiguous sequence with TTL always set

Integration tests are skipped automatically when `REAL_REDIS_TEST` is not set, so normal `pnpm test` runs are unaffected.

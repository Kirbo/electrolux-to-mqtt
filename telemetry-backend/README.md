# Electrolux-to-MQTT Telemetry Backend

Simple telemetry backend for collecting anonymous usage statistics.

## Features

- Anonymous user tracking using irreversible hashes
- Version distribution statistics
- Auto-generated usage badge
- Redis-backed storage with 24-hour TTL
- Docker Compose deployment

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

**Response:**
```json
{
  "success": true
}
```

### GET /telemetry
Get aggregated telemetry statistics.

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

Both endpoints are exempt from rate limiting and exempt from authentication.

- `GET /health` — liveness probe. Returns `200 {"status":"ok"}` when the Express event loop is responsive. Used by the Docker `HEALTHCHECK` directive.
- `GET /health/redis` — readiness probe for the Redis dependency. Returns `200 {"redis":"ok"}` if Redis responds; `503 {"redis":"down"}` otherwise. Use this in your reverse proxy / load balancer to fail traffic over before users hit a 500.

## Environment Variables

- `PORT` - Server port (default: 3001)
- `REDIS_URL` - Redis connection URL (default: redis://redis:6379)
- `RATE_LIMIT_WINDOW_MS` - Rate limit window in ms (default: 60000)
- `RATE_LIMIT_IP_MAX` - Max requests per IP per window (default: 10)
- `RATE_LIMIT_HASH_MAX` - Max requests per userHash per window (default: 1)
- `RATE_LIMIT_SALT` - Optional secret salt used to hash IPs for rate limiting (defaults to `/etc/machine-id` if available, otherwise hostname)
- `TELEMETRY_BEHIND_PROXY` - Set to `true`/`1`/`yes` ONLY when deployed behind a trusted reverse proxy that overwrites client-supplied IP headers (Caddy, nginx, Traefik with `trustForwardHeader`, etc.). Default `false`. **Security-critical**: when `false`, the per-IP rate limiter uses the raw TCP source address (impossible to spoof). When `true`, it trusts `req.ip` (Express, populated from `X-Forwarded-For`) with `X-Real-IP` as a legacy fallback. Setting `true` without a header-rewriting proxy in front allows attackers to bypass the rate limit by rotating client headers.

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
Redis data is persisted using AOF (Append Only File) mode and stored in a Docker volume, ensuring data survives container restarts.

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

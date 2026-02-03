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

## Environment Variables

- `PORT` - Server port (default: 3001)
- `REDIS_URL` - Redis connection URL (default: redis://redis:6379)
- `RATE_LIMIT_WINDOW_MS` - Rate limit window in ms (default: 60000)
- `RATE_LIMIT_IP_MAX` - Max requests per IP per window (default: 10)
- `RATE_LIMIT_HASH_MAX` - Max requests per userHash per window (default: 1)
- `RATE_LIMIT_SALT` - Optional secret salt used to hash IPs for rate limiting (defaults to `/etc/machine-id` if available, otherwise hostname)

## Data Persistence

### Redis Data
Redis data is persisted using AOF (Append Only File) mode and stored in a Docker volume, ensuring data survives container restarts.

### Badge Persistence
The user count badge (`badge/users.svg`) is persisted outside the Docker container in the `./badge` directory. This allows:
- Nginx to serve the badge directly without hitting the application
- Badge to remain accessible even when the Docker container is down
- The badge is automatically regenerated on every telemetry submission

Example Nginx configuration:
```nginx
location /badge {
    alias /path/to/telemetry-backend/badge/users.svg;
    add_header Content-Type image/svg+xml;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
}
```

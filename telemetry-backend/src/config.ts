/**
 * Combined configuration for the telemetry-backend service.
 *
 * Two logical halves:
 *  - Badge side (ClickHouse creds via SOPS .env): reads Aptabase ClickHouse and serves SVG badges.
 *  - Legacy ingest side (non-secret env): receives old-bridge /telemetry POSTs and forwards to Aptabase.
 *
 * All required fields throw a clear FATAL message on startup; optional fields have documented defaults.
 */

export interface BackendConfig {
  // Badge: ClickHouse / Aptabase (SOPS-managed secrets)
  clickhouseUrl: string
  clickhouseUser: string
  clickhousePassword: string
  clickhouseDatabase: string
  aptabaseAppId: string
  badgeIntervalSeconds: number
  releasesApiUrl: string
  releasesPageUrl: string
  // Legacy ingest: Aptabase forwarding (non-secret)
  aptabaseHost: string
  aptabaseAppKey: string
  rateLimitRequests: number
  rateLimitWindowMs: number
  // HTTP server
  port: number
}

const PREFIX = '[telemetry-backend]'

export function readConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const clickhouseUrl = env.CLICKHOUSE_URL
  if (!clickhouseUrl) {
    throw new Error(`${PREFIX} FATAL: CLICKHOUSE_URL is required but not set.`)
  }

  const aptabaseAppId = env.APTABASE_APP_ID
  if (!aptabaseAppId) {
    throw new Error(`${PREFIX} FATAL: APTABASE_APP_ID is required but not set.`)
  }

  const badgeIntervalSeconds = parsePositiveInt(env.BADGE_INTERVAL_SECONDS, 'BADGE_INTERVAL_SECONDS', 300)
  const rateLimitRequests = parsePositiveInt(env.RATE_LIMIT_REQUESTS, 'RATE_LIMIT_REQUESTS', 10)
  const rateLimitWindowMs = parsePositiveInt(env.RATE_LIMIT_WINDOW_MS, 'RATE_LIMIT_WINDOW_MS', 60_000)
  const port = parsePort(env.PORT)

  return {
    clickhouseUrl,
    clickhouseUser: env.CLICKHOUSE_USER ?? 'default',
    clickhousePassword: env.CLICKHOUSE_PASSWORD ?? '',
    clickhouseDatabase: env.CLICKHOUSE_DATABASE ?? 'default',
    aptabaseAppId,
    badgeIntervalSeconds,
    releasesApiUrl: env.RELEASES_API_URL ?? 'https://gitlab.com/api/v4/projects/kirbo%2Felectrolux-to-mqtt/releases',
    releasesPageUrl: env.RELEASES_PAGE_URL ?? 'https://gitlab.com/kirbo/electrolux-to-mqtt/-/releases',
    aptabaseHost: env.APTABASE_HOST ?? 'https://aptabase.devaus.eu',
    aptabaseAppKey: env.APTABASE_APP_KEY ?? 'A-SH-2414786682',
    rateLimitRequests,
    rateLimitWindowMs,
    port,
  }
}

function parsePositiveInt(raw: string | undefined, name: string, defaultValue: number): number {
  if (raw === undefined) return defaultValue
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${PREFIX} FATAL: ${name} must be a positive integer, got: "${raw}"`)
  }
  return parsed
}

function parsePort(raw: string | undefined): number {
  const port = parsePositiveInt(raw, 'PORT', 3002)
  if (port > 65535) {
    throw new Error(`${PREFIX} FATAL: PORT must be between 1 and 65535, got: "${raw ?? ''}"`)
  }
  return port
}

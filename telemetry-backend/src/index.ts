import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHttpForwarder } from './aptabase.js'
import { createBadgeStore } from './badge-store.js'
import { createClickHouseClient } from './clickhouse.js'
import { readConfig } from './config.js'
import { createRateLimiter } from './rate-limit.js'
import { startServer } from './server.js'

function readPkgVersion(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const pkgPath = path.join(__dirname, '..', 'package.json')
  const raw = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(raw) as { version?: unknown }
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
}

/**
 * Startup ClickHouse self-check. Logs a clear error if the events table is
 * unreachable — does NOT crash, so the HTTP server still starts and serves
 * whatever badges were last cached (if any) while CH is transiently unavailable.
 */
async function selfCheck(ch: { query<T>(sql: string, params: Record<string, unknown>): Promise<T[]> }): Promise<void> {
  try {
    await ch.query('SELECT 1 FROM events LIMIT 1', {})
    console.log('[telemetry-backend] ClickHouse self-check passed')
  } catch (err) {
    console.error(
      '[telemetry-backend] ClickHouse self-check failed — events table may be unreachable. Will keep retrying on each cycle.',
      err,
    )
  }
}

async function main(): Promise<void> {
  const config = readConfig()
  const serviceVersion = readPkgVersion()

  console.log(
    `[telemetry-backend] Starting v${serviceVersion} — badge interval: ${config.badgeIntervalSeconds}s, port: ${config.port}`,
  )

  const ch = createClickHouseClient(config)
  await selfCheck(ch)

  const store = createBadgeStore({
    ch,
    appId: config.aptabaseAppId,
    releasesApiUrl: config.releasesApiUrl,
  })

  // First regeneration before the server starts so badges are ready on first request.
  // Failure is best-effort: the store logs the error and stays null; the server
  // serves 503 until the next cycle succeeds.
  await store.regenerate()

  const forwarder = createHttpForwarder(config.aptabaseHost, config.aptabaseAppKey)
  const limiter = createRateLimiter(config.rateLimitRequests, config.rateLimitWindowMs)

  const server = startServer(store, forwarder, limiter, config.port, serviceVersion)

  const intervalId = setInterval(() => {
    void store.regenerate()
  }, config.badgeIntervalSeconds * 1000)

  const shutdown = async (): Promise<void> => {
    console.log('[telemetry-backend] Shutting down...')
    clearInterval(intervalId)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    try {
      await ch.close()
    } catch (err) {
      console.error('[telemetry-backend] Error closing ClickHouse client:', err)
    }
    process.exit(0)
  }

  process.on('SIGTERM', () => {
    void shutdown()
  })
  process.on('SIGINT', () => {
    void shutdown()
  })
}

// Only execute when this file is the process entrypoint, not when imported by tests.
const entryUrl = new URL(import.meta.url).href
const mainUrl = new URL(process.argv[1] ?? '', 'file://').href
if (entryUrl === mainUrl) {
  main().catch((err: unknown) => {
    console.error('[telemetry-backend] Fatal startup error:', err)
    process.exit(1)
  })
}

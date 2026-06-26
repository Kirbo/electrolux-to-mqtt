import { createBadgeStore } from './badge-store.js'
import { createClickHouseClient } from './clickhouse.js'
import { readConfig } from './config.js'

/**
 * One-shot badge regeneration, run via `docker compose exec` after a release so the version
 * badges reflect the new release immediately (instead of waiting for the long-running server's
 * next BADGE_INTERVAL_SECONDS cycle). It writes the SVGs to the same OUTPUT_DIR volume the
 * reverse proxy serves statically, so the running server keeps serving uninterrupted — see
 * `.gitlab/ci/04_release.yml` (`refresh telemetry badges`).
 */
async function main(): Promise<void> {
  const config = readConfig()
  const ch = createClickHouseClient(config)
  const store = createBadgeStore({
    ch,
    appId: config.aptabaseAppId,
    releasesApiUrl: config.releasesApiUrl,
    outputDir: config.outputDir,
  })

  console.log('[telemetry-backend] One-shot badge regeneration starting...')
  await store.regenerate()
  await ch.close()
  console.log('[telemetry-backend] One-shot badge regeneration complete')
}

main().catch((err: unknown) => {
  console.error('[telemetry-backend] Badge regeneration failed:', err)
  process.exit(1)
})

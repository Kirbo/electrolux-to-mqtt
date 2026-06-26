import {
  buildBadgeSvg,
  buildReleaseBadgeSvg,
  compareVersionsDescending,
  fetchLatestReleases,
  INVISIBLE_SVG,
} from './badges.js'
import type { ClickHouseLike } from './clickhouse.js'
import { aggregateTelemetry } from './clickhouse.js'

/**
 * In-memory store for the four badge artifacts (three SVGs + telemetry.json).
 *
 * All values are null until the first successful regeneration cycle. Callers should
 * serve 503 when a value is null (not yet ready). On partial failure (e.g. ClickHouse
 * unreachable), the successful half is still stored and the failed half stays null or
 * retains its last-good value.
 */
export interface BadgeStore {
  getUsersSvg(): string | null
  getStableSvg(): string | null
  getBetaSvg(): string | null
  getTelemetryJson(): string | null
  /** Run one full regeneration cycle (telemetry + releases). Best-effort: individual
   * steps log errors but do not throw — the store keeps last-good on failure. */
  regenerate(): Promise<void>
}

/** Dependency-injected releases fetcher — swappable in tests without touching global fetch. */
export type ReleasesFetcher = (url: string) => Promise<{ stable: string | null; beta: string | null }>

export interface BadgeStoreDeps {
  ch: ClickHouseLike
  appId: string
  releasesApiUrl: string
  /**
   * Releases fetcher; defaults to the real `fetchLatestReleases`. Inject a fake in
   * tests to avoid network calls.
   */
  releasesFetcher?: ReleasesFetcher
}

export function createBadgeStore(deps: BadgeStoreDeps): BadgeStore {
  const { ch, appId, releasesApiUrl } = deps
  const releasesFetcher: ReleasesFetcher = deps.releasesFetcher ?? ((url) => fetchLatestReleases(url))

  let usersSvg: string | null = null
  let stableSvg: string | null = null
  let betaSvg: string | null = null
  let telemetryJson: string | null = null

  async function regenerateTelemetry(): Promise<void> {
    try {
      const result = await aggregateTelemetry(ch, appId)
      usersSvg = buildBadgeSvg(result.total)
      telemetryJson = JSON.stringify(result)
      console.log(`[telemetry-backend] Telemetry updated: ${result.total} users`)
    } catch (err) {
      console.error('[telemetry-backend] Telemetry cycle failed:', err)
    }
  }

  async function regenerateReleases(): Promise<void> {
    try {
      const { stable, beta } = await releasesFetcher(releasesApiUrl)

      if (stable === null && beta === null) {
        console.log('[telemetry-backend] Release badges: no releases found — keeping last good')
        return
      }

      if (stable !== null) {
        const stableVersion = stable.replace(/^v/, '')
        stableSvg = buildReleaseBadgeSvg('stable', stableVersion, '#007ec6')
        console.log(`[telemetry-backend] Release badge updated: stable=${stableVersion}`)
      }

      const betaIsNewer = beta !== null && (stable === null || compareVersionsDescending(beta, stable) < 0)
      if (betaIsNewer && beta !== null) {
        const betaVersion = beta.replace(/^v/, '')
        betaSvg = buildReleaseBadgeSvg('beta', betaVersion, '#fe7d37')
        console.log(`[telemetry-backend] Release badge updated: beta=${betaVersion}`)
      } else {
        betaSvg = INVISIBLE_SVG
        console.log('[telemetry-backend] Release badge updated: beta=invisible (not newer than stable)')
      }
    } catch (err) {
      console.error('[telemetry-backend] Release cycle failed:', err)
    }
  }

  return {
    getUsersSvg: () => usersSvg,
    getStableSvg: () => stableSvg,
    getBetaSvg: () => betaSvg,
    getTelemetryJson: () => telemetryJson,
    async regenerate(): Promise<void> {
      await regenerateTelemetry()
      await regenerateReleases()
    },
  }
}

import fsp from 'node:fs/promises'
import path from 'node:path'
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
 * Regenerates the badge artifacts each cycle and keeps the backend's two roles fed:
 *  - writes `users.svg` / `stable.svg` / `beta.svg` / `telemetry.json` to `outputDir`,
 *    which the reverse proxy serves statically (so badge GETs never hit this container);
 *  - holds the telemetry JSON and the latest release tags in memory for the HTTP
 *    endpoints `GET /telemetry`, `GET /stable`, `GET /beta`.
 *
 * Best-effort: the telemetry half and the releases half each catch their own errors.
 * On failure nothing is overwritten — the disk file and the in-memory value stay as
 * the last-good.
 */
export interface BadgeStore {
  regenerate(): Promise<void>
  /** Latest telemetry JSON (`GET /telemetry`), or null until the first successful cycle. */
  getTelemetryJson(): string | null
  /** Latest stable release tag (`GET /stable` redirect target), or null. */
  getStableTag(): string | null
  /** Latest beta release tag (`GET /beta` redirect target), or null. */
  getBetaTag(): string | null
}

/** Dependency-injected releases fetcher — swappable in tests without touching global fetch. */
export type ReleasesFetcher = (url: string) => Promise<{ stable: string | null; beta: string | null }>

/** Dependency-injected file writer — swappable in tests to avoid touching the real fs. */
export type FileWriter = (filePath: string, content: string) => Promise<void>

export interface BadgeStoreDeps {
  ch: ClickHouseLike
  appId: string
  releasesApiUrl: string
  outputDir: string
  releasesFetcher?: ReleasesFetcher
  writeFile?: FileWriter
}

const defaultWriteFile: FileWriter = async (filePath, content) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

export function createBadgeStore(deps: BadgeStoreDeps): BadgeStore {
  const { ch, appId, releasesApiUrl, outputDir } = deps
  const releasesFetcher: ReleasesFetcher = deps.releasesFetcher ?? ((url) => fetchLatestReleases(url))
  const writeFile: FileWriter = deps.writeFile ?? defaultWriteFile

  let telemetryJson: string | null = null
  let stableTag: string | null = null
  let betaTag: string | null = null

  const file = (name: string): string => path.join(outputDir, name)

  async function regenerateTelemetry(): Promise<void> {
    try {
      const result = await aggregateTelemetry(ch, appId)
      const json = JSON.stringify(result)
      await writeFile(file('users.svg'), buildBadgeSvg(result.total))
      await writeFile(file('telemetry.json'), json)
      telemetryJson = json
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
        stableTag = stable
        await writeFile(file('stable.svg'), buildReleaseBadgeSvg('stable', stable.replace(/^v/, ''), '#007ec6'))
        console.log(`[telemetry-backend] Release badge updated: stable=${stable}`)
      }

      const betaIsNewer = beta !== null && (stable === null || compareVersionsDescending(beta, stable) < 0)
      if (betaIsNewer && beta !== null) {
        betaTag = beta
        await writeFile(file('beta.svg'), buildReleaseBadgeSvg('beta', beta.replace(/^v/, ''), '#fe7d37'))
        console.log(`[telemetry-backend] Release badge updated: beta=${beta}`)
      } else {
        betaTag = null
        await writeFile(file('beta.svg'), INVISIBLE_SVG)
        console.log('[telemetry-backend] Release badge updated: beta=invisible (not newer than stable)')
      }
    } catch (err) {
      console.error('[telemetry-backend] Release cycle failed:', err)
    }
  }

  return {
    async regenerate(): Promise<void> {
      await regenerateTelemetry()
      await regenerateReleases()
    },
    getTelemetryJson: () => telemetryJson,
    getStableTag: () => stableTag,
    getBetaTag: () => betaTag,
  }
}

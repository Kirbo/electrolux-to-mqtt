import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  buildBadgeSvg,
  buildPeakBadgeSvg,
  buildReleaseBadgeSvg,
  compareVersionsDescending,
  fetchLatestReleases,
  INVISIBLE_SVG,
} from './badges.js'
import type { ClickHouseLike } from './clickhouse.js'
import { aggregateTelemetry } from './clickhouse.js'
import type { PeakHistory } from './peaks.js'
import { computePeaks, createEmptyPeakHistory, PEAK_WINDOWS, parsePeakHistory, recordSample } from './peaks.js'

/**
 * Regenerates the badge artifacts each cycle and keeps the backend's two roles fed:
 *  - writes `users.svg` / `peak-<window>.svg` / `stable.svg` / `beta.svg` / `telemetry.json` to `outputDir`,
 *    which the reverse proxy serves statically (so badge GETs never hit this container);
 *  - samples the user count into `peaks-history.json` (same dir) so the trailing-window
 *    peaks in `telemetry.json` survive restarts — see `peaks.ts`;
 *  - holds the telemetry JSON and the latest release tags in memory for the HTTP
 *    endpoints `GET /telemetry`, `GET /stable`, `GET /beta`.
 *
 * Best-effort: the telemetry half and the releases half each catch their own errors.
 * On failure nothing is overwritten — the disk file and the in-memory value stay as
 * the last-good.
 */
/** Per-half outcome of a regeneration cycle — lets one-shot callers fail loudly. */
export interface RegenerateResult {
  telemetryOk: boolean
  releasesOk: boolean
}

export interface BadgeStore {
  regenerate(): Promise<RegenerateResult>
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

/** Dependency-injected file reader — resolves null when the file does not exist. */
export type FileReader = (filePath: string) => Promise<string | null>

export interface BadgeStoreDeps {
  ch: ClickHouseLike
  appId: string
  releasesApiUrl: string
  outputDir: string
  releasesFetcher?: ReleasesFetcher
  writeFile?: FileWriter
  readFile?: FileReader
  /** Clock — injectable so peak bucketing is deterministic in tests. */
  now?: () => number
}

const PEAKS_FILE = 'peaks-history.json'

const defaultWriteFile: FileWriter = async (filePath, content) => {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  await fsp.writeFile(filePath, content, 'utf8')
}

function isMissingFileError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
}

const defaultReadFile: FileReader = async (filePath) => {
  try {
    return await fsp.readFile(filePath, 'utf8')
  } catch (err) {
    if (isMissingFileError(err)) return null
    throw err
  }
}

export function createBadgeStore(deps: BadgeStoreDeps): BadgeStore {
  const { ch, appId, releasesApiUrl, outputDir } = deps
  const releasesFetcher: ReleasesFetcher = deps.releasesFetcher ?? ((url) => fetchLatestReleases(url))
  const writeFile: FileWriter = deps.writeFile ?? defaultWriteFile
  const readFile: FileReader = deps.readFile ?? defaultReadFile
  const now = deps.now ?? (() => Date.now())

  let telemetryJson: string | null = null
  let stableTag: string | null = null
  let betaTag: string | null = null
  let peakHistory: PeakHistory | null = null

  const file = (name: string): string => path.join(outputDir, name)

  /**
   * Load the persisted peak history once. Any failure (unreadable, corrupt, foreign file)
   * falls back to an empty history — documented fallback: peaks rebuild from now on rather
   * than blocking the telemetry cycle.
   */
  async function loadPeakHistory(): Promise<PeakHistory> {
    if (peakHistory !== null) return peakHistory
    const peaksPath = file(PEAKS_FILE)
    let loaded: PeakHistory | null = null
    try {
      const raw = await readFile(peaksPath)
      if (raw !== null) {
        loaded = parsePeakHistory(raw)
        if (loaded === null)
          console.warn(`[telemetry-backend] Ignoring corrupt ${PEAKS_FILE} — starting a fresh peak history`)
      }
    } catch (err) {
      console.error(`[telemetry-backend] Could not read ${PEAKS_FILE} — starting a fresh peak history:`, err)
    }
    peakHistory = loaded ?? createEmptyPeakHistory()
    return peakHistory
  }

  async function regenerateTelemetry(): Promise<boolean> {
    try {
      const result = await aggregateTelemetry(ch, appId)
      const nowMs = now()
      const history = recordSample(await loadPeakHistory(), result.total, nowMs)
      const peaks = computePeaks(history, nowMs)
      const json = JSON.stringify({ ...result, peaks })
      await writeFile(file('users.svg'), buildBadgeSvg(result.total))
      for (const { key } of PEAK_WINDOWS) {
        await writeFile(file(`peak-${key}.svg`), buildPeakBadgeSvg(key, peaks[key]))
      }
      await writeFile(file('telemetry.json'), json)
      await writeFile(file(PEAKS_FILE), JSON.stringify(history))
      peakHistory = history
      telemetryJson = json
      console.log(`[telemetry-backend] Telemetry updated: ${result.total} users`)
      return true
    } catch (err) {
      console.error('[telemetry-backend] Telemetry cycle failed:', err)
      return false
    }
  }

  async function regenerateReleases(): Promise<boolean> {
    try {
      const { stable, beta } = await releasesFetcher(releasesApiUrl)

      if (stable === null && beta === null) {
        console.log('[telemetry-backend] Release badges: no releases found — keeping last good')
        return true
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
      return true
    } catch (err) {
      console.error('[telemetry-backend] Release cycle failed:', err)
      return false
    }
  }

  return {
    async regenerate(): Promise<RegenerateResult> {
      const telemetryOk = await regenerateTelemetry()
      const releasesOk = await regenerateReleases()
      return { telemetryOk, releasesOk }
    },
    getTelemetryJson: () => telemetryJson,
    getStableTag: () => stableTag,
    getBetaTag: () => betaTag,
  }
}

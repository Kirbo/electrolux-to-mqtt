/**
 * Peak user counts over trailing windows.
 *
 * Aptabase only lets us derive the *current* rolling-26h user count (see `clickhouse.ts`).
 * To show the historical peaks the badge store samples that count every cycle and folds it
 * into hourly max buckets. The buckets are persisted to disk (`peaks-history.json` in
 * `OUTPUT_DIR`) so a restart or redeploy does not reset the peaks, and trimmed to the longest
 * window so the file stays a few hundred KB at most (≤ 8,761 buckets).
 *
 * Pure functions — no I/O, no clock — so they are trivially unit-testable; the badge store
 * owns reading/writing the file and passes `Date.now()`.
 */

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

export type PeakWindowKey = '24h' | '7d' | '30d' | '182d' | '365d'

export interface PeakWindow {
  key: PeakWindowKey
  ms: number
}

/** Trailing windows the peaks are reported for: 24h, 1 week, ~1 month, ~6 months, ~12 months. */
export const PEAK_WINDOWS: readonly PeakWindow[] = [
  { key: '24h', ms: DAY_MS },
  { key: '7d', ms: 7 * DAY_MS },
  { key: '30d', ms: 30 * DAY_MS },
  { key: '182d', ms: 182 * DAY_MS },
  { key: '365d', ms: 365 * DAY_MS },
]

/** Buckets older than this are dropped — the longest window plus one bucket of slack. */
export const HISTORY_RETENTION_MS = 365 * DAY_MS + HOUR_MS

const HISTORY_VERSION = 1

export interface PeakBucket {
  /** Bucket start, epoch ms, aligned to the hour. */
  hour: number
  /** Highest sampled user count seen inside this hour. */
  max: number
}

export interface PeakHistory {
  version: typeof HISTORY_VERSION
  /** Sorted ascending by `hour`, unique per hour. */
  buckets: PeakBucket[]
}

export interface Peak {
  value: number
  /** ISO timestamp of the hour bucket the peak was observed in. */
  at: string
}

export type Peaks = Record<PeakWindowKey, Peak | null>

export function createEmptyPeakHistory(): PeakHistory {
  return { version: HISTORY_VERSION, buckets: [] }
}

/** Fold one sample into the history — returns a new history, the input is left untouched. */
export function recordSample(history: PeakHistory, total: number, nowMs: number): PeakHistory {
  const hour = Math.floor(nowMs / HOUR_MS) * HOUR_MS
  const cutoff = nowMs - HISTORY_RETENTION_MS
  const merged = new Map<number, number>()
  for (const b of history.buckets) {
    if (b.hour >= cutoff) merged.set(b.hour, b.max)
  }
  merged.set(hour, Math.max(merged.get(hour) ?? 0, total))
  return { version: HISTORY_VERSION, buckets: sortBuckets(merged) }
}

/** Max sampled count per trailing window; a bucket counts if any part of it overlaps the window. */
export function computePeaks(history: PeakHistory, nowMs: number): Peaks {
  const peaks: Peaks = { '24h': null, '7d': null, '30d': null, '182d': null, '365d': null }
  for (const window of PEAK_WINDOWS) {
    const since = nowMs - window.ms
    let best: PeakBucket | null = null
    for (const b of history.buckets) {
      if (b.hour + HOUR_MS <= since) continue
      if (best === null || b.max > best.max) best = b
    }
    peaks[window.key] = best === null ? null : { value: best.max, at: new Date(best.hour).toISOString() }
  }
  return peaks
}

/**
 * Validate a history file read from disk. Returns null on any structural problem so the
 * caller can start fresh instead of trusting a corrupt or foreign file.
 */
export function parsePeakHistory(raw: string): PeakHistory | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Malformed JSON — documented fallback: caller starts a fresh history.
    return null
  }
  if (!isRecord(parsed) || parsed.version !== HISTORY_VERSION || !Array.isArray(parsed.buckets)) return null

  const merged = new Map<number, number>()
  for (const entry of parsed.buckets) {
    if (!isBucket(entry)) return null
    merged.set(entry.hour, Math.max(merged.get(entry.hour) ?? 0, entry.max))
  }
  return { version: HISTORY_VERSION, buckets: sortBuckets(merged) }
}

function sortBuckets(merged: Map<number, number>): PeakBucket[] {
  return Array.from(merged.entries())
    .map(([hour, max]) => ({ hour, max }))
    .sort((a, b) => a.hour - b.hour)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBucket(value: unknown): value is PeakBucket {
  if (!isRecord(value)) return false
  const { hour, max } = value
  return Number.isInteger(hour) && typeof max === 'number' && Number.isFinite(max) && max >= 0
}

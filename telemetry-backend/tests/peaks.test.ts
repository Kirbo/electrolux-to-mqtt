import { describe, expect, it } from 'vitest'
import {
  computePeaks,
  createEmptyPeakHistory,
  HISTORY_RETENTION_MS,
  PEAK_WINDOWS,
  parsePeakHistory,
  recordSample,
} from '../src/peaks.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const T0 = Date.UTC(2026, 8, 15, 12, 0, 0) // 2026-09-15T12:00:00Z

describe('PEAK_WINDOWS', () => {
  it('covers 24h, 7d, 30d, 182d and 365d in ascending order', () => {
    expect(PEAK_WINDOWS.map((w) => w.key)).toEqual(['24h', '7d', '30d', '182d', '365d'])
    expect(PEAK_WINDOWS.map((w) => w.ms)).toEqual([DAY, 7 * DAY, 30 * DAY, 182 * DAY, 365 * DAY])
  })

  it('retention covers the longest window plus one bucket', () => {
    expect(HISTORY_RETENTION_MS).toBe(365 * DAY + HOUR)
  })
})

describe('recordSample', () => {
  it('starts a new hourly bucket keyed on the hour start', () => {
    const h = recordSample(createEmptyPeakHistory(), 5, T0 + 17 * 60_000)
    expect(h.buckets).toEqual([{ hour: T0, max: 5 }])
  })

  it('keeps the max within the same hour', () => {
    let h = recordSample(createEmptyPeakHistory(), 5, T0)
    h = recordSample(h, 9, T0 + 5 * 60_000)
    h = recordSample(h, 3, T0 + 10 * 60_000)
    expect(h.buckets).toEqual([{ hour: T0, max: 9 }])
  })

  it('appends a new bucket when the hour rolls over', () => {
    let h = recordSample(createEmptyPeakHistory(), 5, T0)
    h = recordSample(h, 4, T0 + HOUR)
    expect(h.buckets).toEqual([
      { hour: T0, max: 5 },
      { hour: T0 + HOUR, max: 4 },
    ])
  })

  it('drops buckets older than the retention window', () => {
    let h = recordSample(createEmptyPeakHistory(), 5, T0)
    h = recordSample(h, 6, T0 + HISTORY_RETENTION_MS + HOUR)
    expect(h.buckets).toEqual([{ hour: T0 + HISTORY_RETENTION_MS + HOUR, max: 6 }])
  })

  it('does not mutate the input history', () => {
    const before = recordSample(createEmptyPeakHistory(), 5, T0)
    const snapshot = JSON.stringify(before)
    recordSample(before, 9, T0)
    expect(JSON.stringify(before)).toBe(snapshot)
  })

  it('folds out-of-order (older) samples into their own bucket', () => {
    let h = recordSample(createEmptyPeakHistory(), 5, T0 + HOUR)
    h = recordSample(h, 7, T0)
    expect(h.buckets).toEqual([
      { hour: T0, max: 7 },
      { hour: T0 + HOUR, max: 5 },
    ])
  })
})

describe('computePeaks', () => {
  it('returns null peaks for an empty history', () => {
    const peaks = computePeaks(createEmptyPeakHistory(), T0)
    for (const w of PEAK_WINDOWS) {
      expect(peaks[w.key]).toBeNull()
    }
  })

  it('reports the max per window with the hour it was seen', () => {
    let h = createEmptyPeakHistory()
    h = recordSample(h, 10, T0 - 300 * DAY) // only inside 365d
    h = recordSample(h, 8, T0 - 100 * DAY) // inside 182d + 365d
    h = recordSample(h, 6, T0 - 20 * DAY) // inside 30d and up
    h = recordSample(h, 7, T0 - 3 * DAY) // inside 7d and up
    h = recordSample(h, 4, T0 - 2 * HOUR) // inside 24h and up
    h = recordSample(h, 5, T0) // now
    const peaks = computePeaks(h, T0)
    expect(peaks['24h']).toEqual({ value: 5, at: new Date(T0).toISOString() })
    expect(peaks['7d']).toEqual({ value: 7, at: new Date(T0 - 3 * DAY).toISOString() })
    expect(peaks['30d']).toEqual({ value: 7, at: new Date(T0 - 3 * DAY).toISOString() })
    expect(peaks['182d']).toEqual({ value: 8, at: new Date(T0 - 100 * DAY).toISOString() })
    expect(peaks['365d']).toEqual({ value: 10, at: new Date(T0 - 300 * DAY).toISOString() })
  })

  it('includes a bucket that overlaps the window edge and excludes one fully outside', () => {
    let h = createEmptyPeakHistory()
    h = recordSample(h, 9, T0 - DAY - 30 * 60_000) // bucket [T0-25h, T0-24h) — fully outside 24h
    h = recordSample(h, 7, T0 - DAY + 30 * 60_000) // bucket [T0-24h, T0-23h) — overlaps
    h = recordSample(h, 1, T0)
    const peaks = computePeaks(h, T0 + 15 * 60_000)
    expect(peaks['24h']?.value).toBe(7)
  })

  it('prefers the earliest hour on a tie', () => {
    let h = createEmptyPeakHistory()
    h = recordSample(h, 5, T0 - 2 * HOUR)
    h = recordSample(h, 5, T0)
    expect(computePeaks(h, T0)['24h']?.at).toBe(new Date(T0 - 2 * HOUR).toISOString())
  })
})

describe('parsePeakHistory', () => {
  it('round-trips a serialized history', () => {
    let h = createEmptyPeakHistory()
    h = recordSample(h, 5, T0)
    h = recordSample(h, 6, T0 + HOUR)
    expect(parsePeakHistory(JSON.stringify(h))).toEqual(h)
  })

  it.each([
    ['not json', '{'],
    ['wrong root', '[]'],
    ['missing version', '{"buckets":[]}'],
    ['wrong version', '{"version":2,"buckets":[]}'],
    ['buckets not array', '{"version":1,"buckets":{}}'],
    ['bucket missing max', '{"version":1,"buckets":[{"hour":0}]}'],
    ['bucket hour not integer', '{"version":1,"buckets":[{"hour":1.5,"max":1}]}'],
    ['bucket max negative', '{"version":1,"buckets":[{"hour":0,"max":-1}]}'],
    ['bucket max not finite', '{"version":1,"buckets":[{"hour":0,"max":"1"}]}'],
  ])('rejects %s', (_label, raw) => {
    expect(parsePeakHistory(raw)).toBeNull()
  })

  it('sorts buckets by hour and dedupes by max', () => {
    const parsed = parsePeakHistory(
      JSON.stringify({
        version: 1,
        buckets: [
          { hour: T0 + HOUR, max: 2 },
          { hour: T0, max: 3 },
          { hour: T0, max: 5 },
        ],
      }),
    )
    expect(parsed).toEqual({
      version: 1,
      buckets: [
        { hour: T0, max: 5 },
        { hour: T0 + HOUR, max: 2 },
      ],
    })
  })
})

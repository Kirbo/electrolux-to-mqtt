import { describe, expect, it } from 'vitest'
import { aggregateTelemetry } from '../src/clickhouse.js'
import { FakeClickHouse } from './fake-clickhouse.js'

const APP_ID = 'test-app-guid'
const WITH_OS = { osBreakdown: true }

type OsRow = { os: string; count: number | string }
type OsVersionRow = { os: string; version: string; count: number | string }

// Helper: build a FakeClickHouse for the five-query setup (total / channels / versions / os / os versions).
// Patterns disambiguate the five SQL statements:
//   - 'uniqExact(session_id) AS total' → total query
//   - 'GROUP BY channel'              → channel-only query (NOT a substring of the next)
//   - 'GROUP BY version, channel'     → per-version query
//   - 'GROUP BY os'                   → OS-only query (NOT a substring of the next)
//   - 'GROUP BY version, os'          → per-OS × version query
function buildFake(
  totalRows: Array<{ total: number | string }>,
  channelRows: Array<{ channel: string; count: number | string }>,
  versionRows: Array<{ version: string; channel: string; count: number | string }>,
  osRows: OsRow[] = [],
  osVersionRows: OsVersionRow[] = [],
): FakeClickHouse {
  const fake = new FakeClickHouse()
  fake.onQuery('uniqExact(session_id) AS total', () => totalRows)
  fake.onQuery('GROUP BY channel', () => channelRows)
  fake.onQuery('GROUP BY version, channel', () => versionRows)
  fake.onQuery('GROUP BY os', () => osRows)
  fake.onQuery('GROUP BY version, os', () => osVersionRows)
  return fake
}

function buildOsFake(osRows: OsRow[], osVersionRows: OsVersionRow[]): FakeClickHouse {
  return buildFake([{ total: 0 }], [], [], osRows, osVersionRows)
}

describe('aggregateTelemetry', () => {
  it('returns the total from its own distinct query, not summed from version rows', async () => {
    const fake = buildFake(
      [{ total: 5 }],
      [
        { channel: 'stable', count: 4 },
        { channel: 'beta', count: 1 },
      ],
      [
        { version: '2026.6.0', channel: 'stable', count: 2 },
        { version: '2026.6.0b1', channel: 'beta', count: 1 },
      ],
    )

    const result = await aggregateTelemetry(fake, APP_ID)
    expect(result.total).toBe(5)
  })

  it('builds channel totals from the distinct channel query, not by summing versions', async () => {
    // The version rows sum to 3 stable, but the same install appears under two stable
    // versions; the distinct channel query reports the real count (2). total must NOT be
    // derived by summing versions.
    const fake = buildFake(
      [{ total: 2 }],
      [{ channel: 'stable', count: 2 }],
      [
        { version: '2026.6.10', channel: 'stable', count: 2 },
        { version: '2026.6.9', channel: 'stable', count: 1 },
      ],
    )

    const result = await aggregateTelemetry(fake, APP_ID)
    expect(result.channels.stable).toBe(2)
    expect(result.channels.beta).toBe(0)
  })

  it('splits stable and beta channel counts', async () => {
    const fake = buildFake(
      [{ total: 3 }],
      [
        { channel: 'stable', count: 2 },
        { channel: 'beta', count: 1 },
      ],
      [],
    )

    const result = await aggregateTelemetry(fake, APP_ID)
    expect(result.channels.stable).toBe(2)
    expect(result.channels.beta).toBe(1)
  })

  it('folds an unknown/empty channel into stable in the channel totals', async () => {
    const fake = buildFake(
      [{ total: 2 }],
      [
        { channel: '', count: 1 },
        { channel: 'unknown-val', count: 1 },
      ],
      [],
    )

    const result = await aggregateTelemetry(fake, APP_ID)
    expect(result.channels.stable).toBe(2)
    expect(result.channels.beta).toBe(0)
  })

  it('folds an empty channel into beta in the version breakdown when the version is pre-release', async () => {
    const fake = buildFake(
      [{ total: 1 }],
      [{ channel: 'beta', count: 1 }],
      [{ version: '2026.6.0b1', channel: '', count: 1 }],
    )

    const result = await aggregateTelemetry(fake, APP_ID)
    const entry = result.versions.find((v) => v.version === '2026.6.0b1')
    expect(entry?.channels.beta).toBe(1)
    expect(entry?.channels.stable).toBe(0)
  })

  it('sorts versions descending', async () => {
    const fake = buildFake(
      [{ total: 3 }],
      [
        { channel: 'stable', count: 2 },
        { channel: 'beta', count: 1 },
      ],
      [
        { version: '2026.5.0', channel: 'stable', count: 1 },
        { version: '2026.6.0', channel: 'stable', count: 1 },
        { version: '2026.6.0b1', channel: 'beta', count: 1 },
      ],
    )

    const result = await aggregateTelemetry(fake, APP_ID)
    const versions = result.versions.map((v) => v.version)
    expect(versions[0]).toBe('2026.6.0')
    expect(versions[1]).toBe('2026.6.0b1')
    expect(versions[2]).toBe('2026.5.0')
  })

  it('caps at top 100 versions', async () => {
    const versionRows = Array.from({ length: 120 }, (_, i) => ({
      version: `2026.${i}.0`,
      channel: 'stable',
      count: 1,
    }))
    const fake = buildFake([{ total: 120 }], [{ channel: 'stable', count: 120 }], versionRows)

    const result = await aggregateTelemetry(fake, APP_ID)
    expect(result.versions).toHaveLength(100)
  })

  it.each([
    { label: 'off', options: {}, queries: 3 },
    { label: 'on', options: WITH_OS, queries: 5 },
  ])(
    'passes app_id as a query param to every query (os breakdown $label), never interpolated',
    async ({ options, queries }) => {
      const captured: Array<{ sql: string; params: Record<string, unknown> }> = []
      const fake = buildFake([{ total: 0 }], [], [])
      const query = fake.query.bind(fake)
      fake.query = async <T>(sql: string, params: Record<string, unknown>): Promise<T[]> => {
        captured.push({ sql, params })
        return query<T>(sql, params)
      }

      await aggregateTelemetry(fake, APP_ID, options)

      expect(captured).toHaveLength(queries)
      for (const { sql, params } of captured) {
        // biome-ignore lint/complexity/useLiteralKeys: bracket access required for Record<string, unknown> with noUncheckedIndexedAccess
        expect(params['app_id']).toBe(APP_ID)
        expect(sql).toContain('app_id={app_id:String}')
        expect(sql).not.toContain(APP_ID)
      }
    },
  )

  it('returns zero totals and empty versions list when no data', async () => {
    const fake = buildFake([{ total: 0 }], [], [])

    const result = await aggregateTelemetry(fake, APP_ID)
    expect(result.total).toBe(0)
    expect(result.channels.stable).toBe(0)
    expect(result.channels.beta).toBe(0)
    expect(result.versions).toHaveLength(0)
    expect(result).not.toHaveProperty('os')
  })

  it('coerces ClickHouse string-serialized UInt64 counts to numbers (no "01" concatenation)', async () => {
    // Real ClickHouse serializes UInt64 aggregates (uniqExact) as JSON strings:
    // "1", not 1. Without coercion, `0 + "1"` string-concatenates to "01" and the
    // total passes the raw "1" straight through. Reproduces the live /telemetry bug.
    const fake = buildFake(
      [{ total: '1' }],
      [{ channel: 'beta', count: '1' }],
      [{ version: '2026.6.11b1', channel: 'beta', count: '01' }],
    )

    const result = await aggregateTelemetry(fake, APP_ID)

    expect(result.total).toBe(1)
    expect(result.channels.stable).toBe(0)
    expect(result.channels.beta).toBe(1)
    const entry = result.versions.find((v) => v.version === '2026.6.11b1')
    expect(entry?.count).toBe(1)
    expect(entry?.channels.beta).toBe(1)
    // Guard against the regression directly: nothing in the JSON should be a quoted number.
    expect(JSON.stringify(result)).not.toContain('"01"')
    expect(JSON.stringify(result)).not.toContain('"1"')
  })

  it('aggregates multiple rows for the same version under different channels', async () => {
    const fake = buildFake(
      [{ total: 3 }],
      [
        { channel: 'stable', count: 2 },
        { channel: 'beta', count: 1 },
      ],
      [
        { version: '2026.6.0', channel: 'stable', count: 2 },
        { version: '2026.6.0', channel: 'beta', count: 1 },
      ],
    )

    const result = await aggregateTelemetry(fake, APP_ID)
    const vEntry = result.versions.find((v) => v.version === '2026.6.0')
    expect(vEntry).toBeDefined()
    expect(vEntry?.count).toBe(3)
    expect(vEntry?.channels.stable).toBe(2)
    expect(vEntry?.channels.beta).toBe(1)
  })

  describe('os breakdown', () => {
    it('is off by default: runs only the three original queries and omits the os key', async () => {
      // No OS handlers registered: FakeClickHouse throws if an OS query runs.
      const fake = new FakeClickHouse()
      fake.onQuery('uniqExact(session_id) AS total', () => [{ total: 1 }])
      fake.onQuery('GROUP BY channel', () => [{ channel: 'stable', count: 1 }])
      fake.onQuery('GROUP BY version, channel', () => [{ version: '1.0.0', channel: 'stable', count: 1 }])

      for (const options of [undefined, {}, { osBreakdown: false }]) {
        const result = await aggregateTelemetry(fake, APP_ID, options)
        expect(Object.keys(result)).toEqual(['total', 'channels', 'versions'])
        expect(JSON.stringify(result)).toBe(
          '{"total":1,"channels":{"stable":1,"beta":0},"versions":[{"version":"1.0.0","count":1,"channels":{"stable":1,"beta":0}}]}',
        )
      }
    })

    it('includes an empty os list when on and there is no data', async () => {
      const result = await aggregateTelemetry(buildOsFake([], []), APP_ID, WITH_OS)
      expect(result.os).toEqual([])
    })

    it('takes each OS count from the distinct per-OS query, not the sum of its version rows', async () => {
      // One Linux install upgraded inside the window: it shows under both versions, but the
      // distinct per-OS query reports it once.
      const fake = buildOsFake(
        [{ os: 'Linux', count: 1 }],
        [
          { os: 'Linux', version: '1.2.0', count: 1 },
          { os: 'Linux', version: '1.1.0', count: 1 },
        ],
      )

      const result = await aggregateTelemetry(fake, APP_ID, WITH_OS)
      expect(result.os).toEqual([
        {
          name: 'Linux',
          count: 1,
          versions: [
            { version: '1.2.0', count: 1 },
            { version: '1.1.0', count: 1 },
          ],
        },
      ])
    })

    it('sorts OS entries by count descending, then by name', async () => {
      const fake = buildOsFake(
        [
          { os: 'Windows', count: 2 },
          { os: 'macOS', count: 5 },
          { os: 'Linux', count: 2 },
        ],
        [],
      )

      const result = await aggregateTelemetry(fake, APP_ID, WITH_OS)
      expect(result.os?.map((o) => [o.name, o.count])).toEqual([
        ['macOS', 5],
        ['Linux', 2],
        ['Windows', 2],
      ])
    })

    it('sorts each OS version list newest first', async () => {
      const fake = buildOsFake(
        [{ os: 'Linux', count: 3 }],
        [
          { os: 'Linux', version: '2026.5.0', count: 1 },
          { os: 'Linux', version: '2026.6.0b1', count: 1 },
          { os: 'Linux', version: '2026.6.0', count: 1 },
        ],
      )

      const result = await aggregateTelemetry(fake, APP_ID, WITH_OS)
      expect(result.os?.[0]?.versions.map((v) => v.version)).toEqual(['2026.6.0', '2026.6.0b1', '2026.5.0'])
    })

    it('keeps versions under the OS they were reported on', async () => {
      const fake = buildOsFake(
        [
          { os: 'Linux', count: 2 },
          { os: 'Windows', count: 1 },
        ],
        [
          { os: 'Linux', version: '1.0.0', count: 2 },
          { os: 'Windows', version: '1.1.0', count: 1 },
        ],
      )

      const result = await aggregateTelemetry(fake, APP_ID, WITH_OS)
      expect(result.os).toEqual([
        { name: 'Linux', count: 2, versions: [{ version: '1.0.0', count: 2 }] },
        { name: 'Windows', count: 1, versions: [{ version: '1.1.0', count: 1 }] },
      ])
    })

    it('maps an empty os_name to "unknown" and merges it with a literal "unknown"', async () => {
      const fake = buildOsFake(
        [
          { os: '', count: 2 },
          { os: 'unknown', count: 1 },
        ],
        [
          { os: '', version: '1.0.0', count: 2 },
          { os: 'unknown', version: '1.0.0', count: 1 },
        ],
      )

      const result = await aggregateTelemetry(fake, APP_ID, WITH_OS)
      expect(result.os).toEqual([{ name: 'unknown', count: 3, versions: [{ version: '1.0.0', count: 3 }] }])
    })

    it('lists an OS seen only in the version query with a zero count', async () => {
      const fake = buildOsFake([], [{ os: 'macOS', version: '1.0.0', count: 1 }])

      const result = await aggregateTelemetry(fake, APP_ID, WITH_OS)
      expect(result.os).toEqual([{ name: 'macOS', count: 0, versions: [{ version: '1.0.0', count: 1 }] }])
    })

    it('coerces string-serialized UInt64 counts', async () => {
      const fake = buildOsFake([{ os: 'Linux', count: '4' }], [{ os: 'Linux', version: '1.0.0', count: '04' }])

      const result = await aggregateTelemetry(fake, APP_ID, WITH_OS)
      expect(result.os).toEqual([{ name: 'Linux', count: 4, versions: [{ version: '1.0.0', count: 4 }] }])
      expect(JSON.stringify(result.os)).not.toMatch(/"0?4"/)
    })
  })
})

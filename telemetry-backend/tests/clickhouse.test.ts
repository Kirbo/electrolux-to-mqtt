import { describe, expect, it } from 'vitest'
import { aggregateTelemetry } from '../src/clickhouse.js'
import { FakeClickHouse } from './fake-clickhouse.js'

const APP_ID = 'test-app-guid'

// Helper: build a FakeClickHouse with the standard two-query setup.
function buildFake(
  totalRows: Array<{ total: number }>,
  versionRows: Array<{ version: string; channel: string; count: number }>,
): FakeClickHouse {
  const fake = new FakeClickHouse()
  fake.onQuery('uniqExact(user_id) AS total', () => totalRows)
  fake.onQuery('GROUP BY version, channel', () => versionRows)
  return fake
}

describe('aggregateTelemetry', () => {
  it('returns the correct total from its own query, not summed from version rows', async () => {
    const fake = buildFake(
      [{ total: 5 }],
      [
        { version: '2026.6.0', channel: 'stable', count: 2 },
        { version: '2026.6.0b1', channel: 'beta', count: 1 },
      ],
    )

    const result = await aggregateTelemetry(fake, APP_ID)
    expect(result.total).toBe(5)
  })

  it('builds channels totals from version rows', async () => {
    const fake = buildFake(
      [{ total: 3 }],
      [
        { version: '2026.6.0', channel: 'stable', count: 2 },
        { version: '2026.6.0b1', channel: 'beta', count: 1 },
      ],
    )

    const result = await aggregateTelemetry(fake, APP_ID)
    expect(result.channels.stable).toBe(2)
    expect(result.channels.beta).toBe(1)
  })

  it('folds unknown channel into stable', async () => {
    const fake = buildFake(
      [{ total: 2 }],
      [
        { version: '2026.6.0', channel: '', count: 1 },
        { version: '2026.6.0', channel: 'unknown-val', count: 1 },
      ],
    )

    const result = await aggregateTelemetry(fake, APP_ID)
    expect(result.channels.stable).toBe(2)
    expect(result.channels.beta).toBe(0)
  })

  it('folds empty channel into beta when version is a pre-release', async () => {
    const fake = buildFake([{ total: 1 }], [{ version: '2026.6.0b1', channel: '', count: 1 }])

    const result = await aggregateTelemetry(fake, APP_ID)
    expect(result.channels.stable).toBe(0)
    expect(result.channels.beta).toBe(1)
  })

  it('sorts versions descending', async () => {
    const fake = buildFake(
      [{ total: 3 }],
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
    const fake = buildFake([{ total: 120 }], versionRows)

    const result = await aggregateTelemetry(fake, APP_ID)
    expect(result.versions).toHaveLength(100)
  })

  it('passes app_id as a query param, never interpolated into SQL', async () => {
    let capturedParams: Record<string, unknown> | null = null
    const fake = new FakeClickHouse()
    fake.onQuery('uniqExact(user_id) AS total', (params) => {
      capturedParams = params
      return [{ total: 0 }]
    })
    fake.onQuery('GROUP BY version, channel', () => [])

    await aggregateTelemetry(fake, APP_ID)

    expect(capturedParams).not.toBeNull()
    const params = capturedParams
    if (params === null) throw new Error('capturedParams must not be null')
    // biome-ignore lint/complexity/useLiteralKeys: bracket access required for Record<string, unknown> with noUncheckedIndexedAccess
    expect(params['app_id']).toBe(APP_ID)
  })

  it('returns zero totals and empty versions list when no data', async () => {
    const fake = buildFake([{ total: 0 }], [])

    const result = await aggregateTelemetry(fake, APP_ID)
    expect(result.total).toBe(0)
    expect(result.channels.stable).toBe(0)
    expect(result.channels.beta).toBe(0)
    expect(result.versions).toHaveLength(0)
  })

  it('aggregates multiple rows for the same version under different channels', async () => {
    const fake = buildFake(
      [{ total: 3 }],
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
})

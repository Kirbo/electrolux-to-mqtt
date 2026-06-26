import { createClient as createClickHouseClientLib } from '@clickhouse/client'
import { compareVersionsDescending, isPreReleaseVersion } from './badges.js'

export interface ClickHouseLike {
  query<T>(sql: string, params: Record<string, unknown>): Promise<T[]>
  close(): Promise<void>
}

export interface TelemetryResult {
  total: number
  channels: { stable: number; beta: number }
  versions: Array<{
    version: string
    count: number
    channels: { stable: number; beta: number }
  }>
}

// Raw row shapes returned by ClickHouse queries
interface TotalRow {
  total: number
}

interface VersionRow {
  version: string
  channel: string
  count: number
}

type VersionEntry = { count: number; channels: { stable: number; beta: number } }

/**
 * Create a ClickHouse client backed by @clickhouse/client.
 * The returned object conforms to ClickHouseLike so it can be swapped with
 * FakeClickHouse in unit tests.
 */
export function createClickHouseClient(config: {
  clickhouseUrl: string
  clickhouseUser: string
  clickhousePassword: string
  clickhouseDatabase: string
}): ClickHouseLike {
  const client = createClickHouseClientLib({
    url: config.clickhouseUrl,
    username: config.clickhouseUser,
    password: config.clickhousePassword,
    database: config.clickhouseDatabase,
  })

  return {
    async query<T>(sql: string, params: Record<string, unknown>): Promise<T[]> {
      const resultSet = await client.query({
        query: sql,
        query_params: params,
        format: 'JSONEachRow',
      })
      return resultSet.json<T>()
    },
    async close(): Promise<void> {
      await client.close()
    },
  }
}

/**
 * Resolve a channel value from a ClickHouse row.
 * Rows whose channel is not exactly 'stable' or 'beta' are folded into
 * 'stable', unless the version itself is a pre-release (beta), in which case
 * the empty/unknown channel is mapped to 'beta'.
 */
function resolveChannel(channel: string, version: string): 'stable' | 'beta' {
  if (channel === 'stable' || channel === 'beta') return channel
  return isPreReleaseVersion(version) ? 'beta' : 'stable'
}

/**
 * Aggregate telemetry from Aptabase's ClickHouse events table.
 *
 * Two separate queries are issued:
 *   1. A total distinct-user count (a user may appear under >1 version in a day,
 *      so summing per-version counts would overcount).
 *   2. Per-version × channel distinct-user counts for the breakdown.
 *
 * Both queries are parameterized — app_id is never interpolated into the SQL.
 * The calendar-UTC-day window matches Aptabase's daily-salt rotation.
 */
export async function aggregateTelemetry(ch: ClickHouseLike, appId: string): Promise<TelemetryResult> {
  const params: Record<string, unknown> = { app_id: appId }

  const [totalRows, versionRows] = await Promise.all([
    ch.query<TotalRow>(
      `SELECT uniqExact(user_id) AS total FROM events WHERE app_id={app_id:String} AND event_name='version_check' AND timestamp>=toStartOfDay(now())`,
      params,
    ),
    ch.query<VersionRow>(
      `SELECT app_version AS version, JSONExtractString(string_props,'channel') AS channel, uniqExact(user_id) AS count FROM events WHERE app_id={app_id:String} AND event_name='version_check' AND timestamp>=toStartOfDay(now()) GROUP BY version, channel`,
      params,
    ),
  ])

  const total = totalRows[0]?.total ?? 0
  const channels = { stable: 0, beta: 0 }
  const byVersion = new Map<string, VersionEntry>()

  for (const row of versionRows) {
    const ch2 = resolveChannel(row.channel, row.version)
    channels[ch2] += row.count

    const entry = byVersion.get(row.version) ?? { count: 0, channels: { stable: 0, beta: 0 } }
    entry.count += row.count
    entry.channels[ch2] += row.count
    byVersion.set(row.version, entry)
  }

  const versions = Array.from(byVersion.entries())
    .map(([version, entry]) => ({ version, count: entry.count, channels: entry.channels }))
    .sort((a, b) => compareVersionsDescending(a.version, b.version))
    .slice(0, 100)

  return { total, channels, versions }
}

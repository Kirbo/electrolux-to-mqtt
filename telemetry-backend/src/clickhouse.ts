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

// Raw row shapes returned by ClickHouse queries. ClickHouse serializes UInt64
// aggregates (uniqExact) as JSON *strings* in JSONEachRow, so counts arrive as
// e.g. "1", not 1 — the union reflects that and forces coercion via toCount.
interface TotalRow {
  total: string | number
}

interface ChannelRow {
  channel: string
  count: string | number
}

interface VersionRow {
  version: string
  channel: string
  count: string | number
}

// Rolling window for the "users" count. Must exceed the version-checker's 24h max poll
// interval (config: VERSION_CHECK_INTERVAL ≤ 86400s) so every install that pinged at least
// once is always inside it — the count then holds steady around the clock instead of
// resetting at UTC midnight. The 2h slack absorbs clock skew / a slightly late poll.
const USER_WINDOW_HOURS = 26

type VersionEntry = { count: number; channels: { stable: number; beta: number } }

/**
 * Coerce a ClickHouse-returned count to a finite, non-negative integer.
 * UInt64 aggregates come back as JSON strings ("1"), so without this every
 * `0 + "1"` would string-concatenate to "01" and totals would leak raw strings.
 * Unparseable values fold to 0 so one bad row can't poison the arithmetic.
 */
function toCount(value: string | number): number {
  const n = typeof value === 'number' ? value : Number.parseInt(value, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

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
 * Counts distinct installs over a rolling {@link USER_WINDOW_HOURS} window, keyed on
 * `session_id` (a stable per-install id — Aptabase's own `user_id` rotates with a daily
 * salt, so it can't be counted across midnight). The rolling window keeps the count steady
 * around the clock instead of building up from a UTC-midnight reset.
 *
 * Three parameterized queries (app_id is never interpolated):
 *   1. total  — distinct installs (one install on >1 version still counts once).
 *   2. channels — distinct installs per channel (so `stable`/`beta` are real user counts,
 *      not the over-counting sum of the per-version rows).
 *   3. versions — per-version × channel distinct installs for the breakdown.
 */
export async function aggregateTelemetry(ch: ClickHouseLike, appId: string): Promise<TelemetryResult> {
  const params: Record<string, unknown> = { app_id: appId }
  // USER_WINDOW_HOURS is a hardcoded integer constant, not user input — safe to inline.
  const windowClause = `app_id={app_id:String} AND event_name='version_check' AND timestamp >= now() - INTERVAL ${USER_WINDOW_HOURS} HOUR`

  const [totalRows, channelRows, versionRows] = await Promise.all([
    ch.query<TotalRow>(`SELECT uniqExact(session_id) AS total FROM events WHERE ${windowClause}`, params),
    ch.query<ChannelRow>(
      `SELECT JSONExtractString(string_props,'channel') AS channel, uniqExact(session_id) AS count FROM events WHERE ${windowClause} GROUP BY channel`,
      params,
    ),
    ch.query<VersionRow>(
      `SELECT app_version AS version, JSONExtractString(string_props,'channel') AS channel, uniqExact(session_id) AS count FROM events WHERE ${windowClause} GROUP BY version, channel`,
      params,
    ),
  ])

  const total = toCount(totalRows[0]?.total ?? 0)

  // Channels come from their own distinct query (no version available, so an unknown/empty
  // channel folds to stable — in practice every stored event carries a concrete channel).
  const channels = { stable: 0, beta: 0 }
  for (const row of channelRows) {
    channels[resolveChannel(row.channel, '')] += toCount(row.count)
  }

  const byVersion = new Map<string, VersionEntry>()
  for (const row of versionRows) {
    const ch2 = resolveChannel(row.channel, row.version)
    const count = toCount(row.count)
    const entry = byVersion.get(row.version) ?? { count: 0, channels: { stable: 0, beta: 0 } }
    entry.count += count
    entry.channels[ch2] += count
    byVersion.set(row.version, entry)
  }

  const versions = Array.from(byVersion.entries())
    .map(([version, entry]) => ({ version, count: entry.count, channels: entry.channels }))
    .sort((a, b) => compareVersionsDescending(a.version, b.version))
    .slice(0, 100)

  return { total, channels, versions }
}

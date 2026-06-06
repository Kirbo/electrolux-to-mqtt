import fsp from 'node:fs/promises'
import path from 'node:path'
import express, { type Express, type Request, type Response } from 'express'
import helmet from 'helmet'
import { getClientIp, hashIp, isPreReleaseVersion, validateTelemetryPayload } from './utils.js'

// Minimal Redis surface used by the telemetry backend. Defining it as an
// interface keeps the app testable with a lightweight in-memory fake.
export interface RedisLike {
  /**
   * Atomically increment a counter and set its TTL on first creation.
   * Semantics: INCR key; if new value === 1 then PEXPIRE key ttlMs.
   * Returns the new counter value.
   */
  incrWithTtl(key: string, ttlMs: number): Promise<number>
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  setEx(key: string, seconds: number, value: string): Promise<unknown>
  scanIterator(options: { MATCH?: string; COUNT?: number }): AsyncIterable<string[]>
}

export interface AppConfig {
  rateLimitWindowMs: number
  rateLimitIpMax: number
  rateLimitHashMax: number
  rateLimitSalt: string
  badgeDir: string
  /**
   * Set to true when the backend is fronted by a trusted reverse proxy that
   * rewrites X-Forwarded-For / X-Real-IP before forwarding requests.
   * When false (default), only the TCP source address is used for rate limiting
   * so that clients cannot bypass the per-IP limit by rotating proxy headers.
   */
  behindProxy: boolean
  /**
   * Circuit-breaker threshold: consecutive Redis rate-limit failures before the
   * breaker opens. Default: 5.
   */
  rateLimitBreakerThreshold: number
  /**
   * Rolling window for counting consecutive failures (ms). Default: 60 000.
   */
  rateLimitBreakerWindowMs: number
  /**
   * How long the breaker stays open before transitioning to half-open (ms).
   * Default: 30 000.
   */
  rateLimitBreakerCooldownMs: number
  /**
   * GitLab releases API URL for fetching the latest stable and beta release tags.
   * Example: 'https://gitlab.com/api/v4/projects/kirbo%2Felectrolux-to-mqtt/releases'
   */
  releasesApiUrl: string
  /**
   * GitLab releases page URL used for badge links and redirect fallback.
   * Example: 'https://gitlab.com/kirbo/electrolux-to-mqtt/-/releases'
   */
  releasesPageUrl: string
}

export interface AppDependencies {
  redis: RedisLike
  config: AppConfig
}

const USER_TTL_SECONDS = 24 * 60 * 60
const CACHED_TELEMETRY_KEY = 'cached:telemetry'
export const RELEASE_STABLE_KEY = 'release:stable'
export const RELEASE_BETA_KEY = 'release:beta'

const INVISIBLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"/>'

export async function getUserKeys(redis: RedisLike): Promise<string[]> {
  const keys: string[] = []
  // node-redis v5 yields an array of keys per SCAN batch (breaking change from v4,
  // which yielded individual keys). Spread each batch into the accumulator.
  for await (const batch of redis.scanIterator({ MATCH: 'user:*', COUNT: 1000 })) {
    keys.push(...batch)
  }
  return keys
}

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  preRelease: string | null
}

/**
 * Split a cleaned (no leading 'v') version string into its numeric core and
 * pre-release label. Supports two pre-release forms:
 *   - SemVer dash:  "1.18.5-rc.1"  → core "1.18.5", pre "rc.1"
 *   - CalVer beta:  "2026.6.0b1"   → core "2026.6.0", pre "b1"
 *   - Stable:       "2026.6.0"     → core "2026.6.0", pre null
 */
function splitParsedVersion(withoutV: string): { numeric: string; preRelease: string | null } {
  const dashIndex = withoutV.indexOf('-')
  if (dashIndex !== -1) {
    return { numeric: withoutV.slice(0, dashIndex), preRelease: withoutV.slice(dashIndex + 1) }
  }
  const m = /^(\d+(?:\.\d+)*)(b\d+)$/.exec(withoutV)
  if (m?.[1] !== undefined && m[2] !== undefined) {
    return { numeric: m[1], preRelease: m[2] }
  }
  return { numeric: withoutV, preRelease: null }
}

function parseVersion(raw: string): ParsedVersion {
  const withoutV = raw.replace(/^v/, '')
  const { numeric, preRelease } = splitParsedVersion(withoutV)
  const [maj, min, pat] = numeric.split('.').map(Number)
  return {
    major: maj ?? 0,
    minor: min ?? 0,
    patch: pat ?? 0,
    preRelease,
  }
}

function comparePreRelease(a: string, b: string): number {
  // Extract all digits so both "rc.10" and "b2" compare numerically.
  // /\D/g removal is non-backtracking (single negated class) and avoids ReDoS.
  const numA = Number.parseInt(a.replace(/\D/g, '') || '0', 10)
  const numB = Number.parseInt(b.replace(/\D/g, '') || '0', 10)
  if (numB !== numA) return numB - numA
  // Same numeric suffix — fall back to lexicographic prefix comparison
  if (b > a) return 1
  if (b < a) return -1
  return 0
}

function compareVersionsDescending(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)

  const majorDiff = pb.major - pa.major
  if (majorDiff !== 0) return majorDiff

  const minorDiff = pb.minor - pa.minor
  if (minorDiff !== 0) return minorDiff

  const patchDiff = pb.patch - pa.patch
  if (patchDiff !== 0) return patchDiff

  // Numeric parts equal — stable beats pre-release
  if (pa.preRelease === null && pb.preRelease !== null) return -1
  if (pa.preRelease !== null && pb.preRelease === null) return 1

  if (pa.preRelease !== null && pb.preRelease !== null) {
    return comparePreRelease(pa.preRelease, pb.preRelease)
  }

  return 0
}

/**
 * Escape characters that are special in XML/SVG text content and attribute values.
 * Must escape `&` first to avoid double-escaping subsequent replacements.
 */
function escapeXml(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildBadgeSvg(total: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="100" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h47v20H0z"/>
    <path fill="#4c1" d="M47 0h53v20H47z"/>
    <path fill="url(#b)" d="M0 0h100v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="24.5" y="15" fill="#010101" fill-opacity=".3">Users</text>
    <text x="24.5" y="14">Users</text>
    <text x="72.5" y="15" fill="#010101" fill-opacity=".3">${escapeXml(String(total))}</text>
    <text x="72.5" y="14">${escapeXml(String(total))}</text>
  </g>
</svg>`
}

function buildReleaseBadgeSvg(label: string, version: string, color: string): string {
  // Use raw strings for geometry (length in display chars, not escaped entity chars)
  const labelWidth = Math.round(label.length * 7 + 14)
  const valueWidth = Math.round(version.length * 7 + 14)
  const totalWidth = labelWidth + valueWidth
  const labelX = Math.round(labelWidth / 2)
  const valueX = labelWidth + Math.round(valueWidth / 2)

  // Escape only for text node interpolation — never reassign the geometry variables
  const safeLabel = escapeXml(label)
  const safeVersion = escapeXml(version)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h${labelWidth}v20H0z"/>
    <path fill="${color}" d="M${labelWidth} 0h${valueWidth}v20H${labelWidth}z"/>
    <path fill="url(#b)" d="M0 0h${totalWidth}v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelX}" y="15" fill="#010101" fill-opacity=".3">${safeLabel}</text>
    <text x="${labelX}" y="14">${safeLabel}</text>
    <text x="${valueX}" y="15" fill="#010101" fill-opacity=".3">${safeVersion}</text>
    <text x="${valueX}" y="14">${safeVersion}</text>
  </g>
</svg>`
}

function isBetaTag(tagName: string): boolean {
  const withoutV = tagName.replace(/^v/, '')
  return /b\d+$/.test(withoutV)
}

function hasStringTagName(v: unknown): v is { tag_name: string } {
  return typeof v === 'object' && v !== null && 'tag_name' in v && typeof v.tag_name === 'string'
}

export async function fetchLatestReleases(
  url: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ stable: string | null; beta: string | null }> {
  const res = await fetchFn(url)
  if (!res.ok) {
    throw new Error(`GitLab releases API returned ${res.status}`)
  }
  const data: unknown = await res.json()
  if (!Array.isArray(data)) {
    throw new Error('GitLab releases API returned a non-array body')
  }

  let stable: string | null = null
  let beta: string | null = null

  for (const item of data) {
    if (!hasStringTagName(item)) continue
    const tag = item.tag_name
    if (stable === null && !isBetaTag(tag)) {
      stable = tag
    }
    if (beta === null && isBetaTag(tag)) {
      beta = tag
    }
    if (stable !== null && beta !== null) break
  }

  return { stable, beta }
}

export async function generateReleaseBadges(opts: {
  config: AppConfig
  redis: RedisLike
  fetchFn?: typeof globalThis.fetch
}): Promise<void> {
  const { config, redis, fetchFn } = opts
  try {
    const { stable, beta } = await fetchLatestReleases(config.releasesApiUrl, fetchFn)

    // No usable data — empty release list. Preserve existing badges and Redis keys.
    if (stable === null && beta === null) {
      console.log('Release badges: no releases found — preserving existing badges')
      return
    }

    // Store tags in Redis for redirect endpoints (best-effort, only when data is available)
    try {
      if (stable !== null) {
        await redis.set(RELEASE_STABLE_KEY, stable)
      }
      if (beta !== null) {
        await redis.set(RELEASE_BETA_KEY, beta)
      }
    } catch (redisError) {
      console.error('Error storing release tags in Redis:', redisError)
    }

    // Write stable badge only when a stable release exists
    if (stable !== null) {
      const stableVersion = stable.replace(/^v/, '')
      try {
        const stablePath = path.join(config.badgeDir, 'stable.svg')
        await fsp.mkdir(path.dirname(stablePath), { recursive: true })
        await fsp.writeFile(stablePath, buildReleaseBadgeSvg('stable', stableVersion, '#007ec6'))
        console.log(`Release badge updated: stable=${stableVersion}`)
      } catch {
        // Badge file write is non-critical — the SVG is served via a
        // Docker volume or reverse proxy, so it may not be writable here.
      }
    }

    // Beta is considered "newer" (and thus visible) when beta !== null and its
    // version sorts before the stable (i.e. compareVersionsDescending(beta, stable) < 0
    // means beta is newer). When stable is null and beta exists, beta is also shown.
    const betaIsNewer = beta !== null && (stable === null || compareVersionsDescending(beta, stable) < 0)

    try {
      const betaPath = path.join(config.badgeDir, 'beta.svg')
      await fsp.mkdir(path.dirname(betaPath), { recursive: true })
      if (betaIsNewer && beta !== null) {
        const betaVersion = beta.replace(/^v/, '')
        await fsp.writeFile(betaPath, buildReleaseBadgeSvg('beta', betaVersion, '#fe7d37'))
        console.log(`Release badge updated: beta=${betaVersion}`)
      } else {
        await fsp.writeFile(betaPath, INVISIBLE_SVG)
        console.log('Release badge updated: beta=invisible (not newer than stable)')
      }
    } catch {
      // Badge file write is non-critical — see above.
    }
  } catch (error) {
    console.error('Error generating release badges:', error)
  }
}

/**
 * Parse a stored user value, separating the version from the optional channel.
 * Stored format: "version\tchannel" (with channel) or "version" (legacy, no tab).
 * Derives channel from version string when no explicit channel is stored.
 */
function parseUserValue(raw: string): { version: string; channel: 'stable' | 'beta' } {
  const tabIdx = raw.indexOf('\t')
  if (tabIdx !== -1) {
    const version = raw.slice(0, tabIdx)
    const storedChannel = raw.slice(tabIdx + 1)
    const channel: 'stable' | 'beta' = storedChannel === 'beta' ? 'beta' : 'stable'
    return { version, channel }
  }
  // Legacy: no channel stored — derive from version string
  const channel: 'stable' | 'beta' = isPreReleaseVersion(raw) ? 'beta' : 'stable'
  return { version: raw, channel }
}

type VersionEntry = { count: number; channels: { stable: number; beta: number } }

function accumulateVersions(rawValues: (string | null)[]): {
  totalChannels: { stable: number; beta: number }
  byVersion: Map<string, VersionEntry>
} {
  const totalChannels = { stable: 0, beta: 0 }
  const byVersion = new Map<string, VersionEntry>()

  for (const raw of rawValues) {
    if (!raw) continue
    const { version, channel } = parseUserValue(raw)
    totalChannels[channel] += 1
    const entry = byVersion.get(version) ?? { count: 0, channels: { stable: 0, beta: 0 } }
    entry.count += 1
    entry.channels[channel] += 1
    byVersion.set(version, entry)
  }

  return { totalChannels, byVersion }
}

// Update the telemetry cache in Redis and write the badge SVG file.
// The cache update runs first so GET /telemetry works even when the
// badge file write fails (e.g. read-only filesystem / non-root user).
export async function generateBadge({ redis, config }: AppDependencies): Promise<void> {
  try {
    const keys = await getUserKeys(redis)
    const total = keys.length

    if (total === 0) {
      await redis.set(
        CACHED_TELEMETRY_KEY,
        JSON.stringify({ total: 0, channels: { stable: 0, beta: 0 }, versions: [] }),
      )
    } else {
      const rawValues = await Promise.all(keys.map((key) => redis.get(key)))
      const { totalChannels, byVersion } = accumulateVersions(rawValues)

      // Cap to top 100 entries: sort by version desc.
      const versionsList = Array.from(byVersion.entries())
        .map(([version, entry]) => ({ version, count: entry.count, channels: entry.channels }))
        .sort((a, b) => compareVersionsDescending(a.version, b.version))
        .slice(0, 100)

      await redis.set(CACHED_TELEMETRY_KEY, JSON.stringify({ total, channels: totalChannels, versions: versionsList }))
    }

    // Write badge SVG file (best-effort — may fail on read-only filesystems)
    try {
      const badgePath = path.join(config.badgeDir, 'users.svg')
      await fsp.mkdir(path.dirname(badgePath), { recursive: true })
      await fsp.writeFile(badgePath, buildBadgeSvg(total))
    } catch {
      // Badge file write is non-critical — the SVG is served via a
      // Docker volume or reverse proxy, so it may not be writable here.
    }

    console.log(`Telemetry cache updated: ${total} users`)
  } catch (error) {
    console.error('Error updating telemetry cache:', error)
  }
}

// ── Circuit-breaker state (per createApp instance, not global) ───────────────
type BreakerState = 'closed' | 'open' | 'half-open'

interface BreakerStatus {
  state: BreakerState
  failures: number
}

function isTestHashBypass(req: Request): boolean {
  const { userHash } = req.body as { userHash?: unknown }
  return process.env.ALLOW_TEST_TELEMETRY === 'true' && typeof userHash === 'string' && userHash.includes('test-hash')
}

export function createApp(deps: AppDependencies): Express {
  const { redis, config } = deps
  const app = express()

  // ── Circuit-breaker state (scoped to this app instance) ────────────────────
  let breakerState: BreakerState = 'closed'
  let breakerFailures = 0
  let breakerWindowStart = Date.now()
  let breakerOpenedAt = 0

  function recordBreakerSuccess(): void {
    breakerState = 'closed'
    breakerFailures = 0
    breakerWindowStart = Date.now()
  }

  function recordBreakerFailure(): void {
    const now = Date.now()
    // Reset count if rolling window has elapsed
    if (now - breakerWindowStart > config.rateLimitBreakerWindowMs) {
      breakerFailures = 0
      breakerWindowStart = now
    }
    breakerFailures += 1
    if (breakerFailures >= config.rateLimitBreakerThreshold) {
      breakerState = 'open'
      breakerOpenedAt = now
    }
  }

  function getBreakerStatus(): BreakerStatus {
    if (breakerState === 'open') {
      const now = Date.now()
      if (now - breakerOpenedAt >= config.rateLimitBreakerCooldownMs) {
        breakerState = 'half-open'
      }
    }
    return { state: breakerState, failures: breakerFailures }
  }

  // Security headers — applied first so every response, including health endpoints, carries them
  app.use(
    helmet({
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
    }),
  )

  // Only trust proxy headers when explicitly configured. When false (default),
  // Express will not populate req.ip from X-Forwarded-For, and getClientIp
  // will use the raw TCP source address to prevent rate-limit header spoofing.
  if (config.behindProxy) {
    app.set('trust proxy', 1)
  }

  // Strict Content-Type enforcement for POST requests.
  // Reject early (415) before body parsing, so that malformed content-type
  // requests don't reach the rate-limit middleware for POST /telemetry.
  app.use((req: Request, res: Response, next: () => void) => {
    if (req.method === 'POST') {
      const ct = req.get('Content-Type') ?? ''
      if (!ct.includes('application/json')) {
        res.status(415).json({ error: 'Content-Type must be application/json' })
        return
      }
    }
    next()
  })

  app.use(express.json({ limit: '10kb' }))

  // Health endpoints — placed before rate-limit middleware so they are never
  // rate-limited and remain reachable during traffic spikes.
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' })
  })

  app.get('/health/redis', async (_req: Request, res: Response) => {
    try {
      await redis.get('health-probe')
      res.json({ redis: 'ok' })
    } catch (error) {
      console.error('Redis health probe failed:', error)
      res.status(503).json({ redis: 'down' })
    }
  })

  // Rate-limit circuit-breaker status — for observability
  app.get('/health/rate-limit', (_req: Request, res: Response) => {
    res.json(getBreakerStatus())
  })

  // Release redirect endpoints — forward to the specific GitLab release page.
  // Falls back to the base releases page when no tag is stored or Redis errors.
  async function redirectToRelease(key: string, res: Response): Promise<void> {
    try {
      const tag = await redis.get(key)
      if (tag) {
        res.redirect(302, `${config.releasesPageUrl}/${tag}`)
      } else {
        res.redirect(302, config.releasesPageUrl)
      }
    } catch (error) {
      console.error(`Error reading release key ${key} from Redis:`, error)
      res.redirect(302, config.releasesPageUrl)
    }
  }

  app.get('/stable', (_req: Request, res: Response) => {
    void redirectToRelease(RELEASE_STABLE_KEY, res)
  })

  app.get('/beta', (_req: Request, res: Response) => {
    void redirectToRelease(RELEASE_BETA_KEY, res)
  })

  async function enforceRateLimitRedis(key: string, max: number, res: Response): Promise<boolean> {
    const status = getBreakerStatus()

    // Breaker open: Redis circuit is broken, fail closed (503)
    if (status.state === 'open') {
      res.status(503).json({ error: 'Service temporarily unavailable' })
      return false
    }

    try {
      const redisKey = `ratelimit:${key}`
      // Atomic increment-with-TTL: INCR then PEXPIRE on first creation.
      // Ensures TTL is always set even under concurrent requests.
      const count = await redis.incrWithTtl(redisKey, config.rateLimitWindowMs)

      if (count > max) {
        res.set('Retry-After', String(Math.ceil(config.rateLimitWindowMs / 1000)))
        res.status(429).json({ error: 'Too many requests' })
        return false
      }

      // Probe succeeded — reset breaker if in half-open
      if (status.state === 'half-open') {
        recordBreakerSuccess()
      }

      return true
    } catch (error) {
      // Redis failure — record for circuit breaker
      console.error('Rate limit check failed:', error)
      recordBreakerFailure()

      const newStatus = getBreakerStatus()
      if (newStatus.state === 'open' || newStatus.state === 'half-open') {
        // Breaker just tripped (or probe failed) — fail closed
        if (newStatus.state === 'open') {
          res.status(503).json({ error: 'Service temporarily unavailable' })
          return false
        }
        // half-open probe failed: re-open
        breakerState = 'open'
        breakerOpenedAt = Date.now()
        res.status(503).json({ error: 'Service temporarily unavailable' })
        return false
      }

      // Not yet at threshold — fail open (allow the request)
      return true
    }
  }

  async function rateLimitByIp(req: Request, res: Response, next: () => void) {
    // Test-hash bypass skips all rate limiting when ALLOW_TEST_TELEMETRY=true.
    if (isTestHashBypass(req)) {
      return next()
    }
    const ip = getClientIp(req, config.behindProxy)
    const ipKey = `ip:${hashIp(ip, config.rateLimitSalt)}`
    if (!(await enforceRateLimitRedis(ipKey, config.rateLimitIpMax, res))) {
      return
    }
    return next()
  }

  // POST /telemetry - Store user telemetry data
  // Rate limiting runs BEFORE validation — malformed requests must still consume quota.
  app.post('/telemetry', rateLimitByIp, async (req: Request, res: Response) => {
    try {
      const { userHash, version, channel } = req.body as {
        userHash?: unknown
        version?: unknown
        channel?: unknown
      }

      // Test-hash bypass — only active when ALLOW_TEST_TELEMETRY=true (never in production by default).
      if (isTestHashBypass(req)) {
        return res.json({ success: true, message: 'Test data ignored' })
      }

      // Hash rate limit before any validation.
      // When userHash is not a valid string, skip the hash rate-limit
      // (rely on per-IP rate-limit only) — avoids the hash:unknown-<ip>
      // duplication where every invalid payload burns the same IP-derived key.
      if (typeof userHash === 'string' && userHash) {
        const hashKey = `hash:${userHash}`
        if (!(await enforceRateLimitRedis(hashKey, config.rateLimitHashMax, res))) {
          return
        }
      }

      if (typeof userHash !== 'string' || !userHash || typeof version !== 'string' || !version) {
        return res.status(400).json({ error: 'userHash and version are required' })
      }

      const validationError = validateTelemetryPayload(userHash, version, channel)
      if (validationError) {
        return res.status(400).json({ error: validationError })
      }

      // Encode channel into stored value: "version\tchannel" when channel present, plain version otherwise.
      // Tabs never appear in version strings so splitting on \t is unambiguous.
      const storedValue = channel === 'stable' || channel === 'beta' ? `${version}\t${channel}` : version

      // Store in Redis with 24-hour TTL
      const key = `user:${userHash}`
      await redis.setEx(key, USER_TTL_SECONDS, storedValue)

      // Fire-and-forget badge regeneration — don't block the response path
      generateBadge(deps).catch((err: unknown) => {
        console.error('Badge generation failed:', err)
      })

      res.json({ success: true })
    } catch (error) {
      console.error('Error storing telemetry:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // GET /telemetry - Get aggregated telemetry data (read-only)
  app.get('/telemetry', async (_req: Request, res: Response) => {
    try {
      const cached = await redis.get(CACHED_TELEMETRY_KEY)
      res.json(cached ? JSON.parse(cached) : { total: 0, channels: { stable: 0, beta: 0 }, versions: [] })
    } catch (error) {
      console.error('Error fetching telemetry:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return app
}

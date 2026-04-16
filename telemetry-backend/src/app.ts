import fsp from 'node:fs/promises'
import path from 'node:path'
import express, { type Express, type Request, type Response } from 'express'
import helmet from 'helmet'
import { getClientIp, hashIp, validateTelemetryPayload } from './utils.js'

// Minimal Redis surface used by the telemetry backend. Defining it as an
// interface keeps the app testable with a lightweight in-memory fake.
export interface RedisLike {
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
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
}

export interface AppDependencies {
  redis: RedisLike
  config: AppConfig
}

const USER_TTL_SECONDS = 24 * 60 * 60
const CACHED_TELEMETRY_KEY = 'cached:telemetry'

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

function parseVersion(raw: string): ParsedVersion {
  const withoutV = raw.replace(/^v/, '')
  const dashIndex = withoutV.indexOf('-')
  const numeric = dashIndex === -1 ? withoutV : withoutV.slice(0, dashIndex)
  const preRelease = dashIndex === -1 ? null : withoutV.slice(dashIndex + 1)
  const [maj, min, pat] = numeric.split('.').map(Number)
  return {
    major: maj ?? 0,
    minor: min ?? 0,
    patch: pat ?? 0,
    preRelease,
  }
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

  // Both pre-release — compare lexicographically (rc.2 > rc.1 works naturally)
  if (pa.preRelease !== null && pb.preRelease !== null) {
    return pb.preRelease > pa.preRelease ? 1 : pb.preRelease < pa.preRelease ? -1 : 0
  }

  return 0
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
    <text x="72.5" y="15" fill="#010101" fill-opacity=".3">${total}</text>
    <text x="72.5" y="14">${total}</text>
  </g>
</svg>`
}

// Update the telemetry cache in Redis and write the badge SVG file.
// The cache update runs first so GET /telemetry works even when the
// badge file write fails (e.g. read-only filesystem / non-root user).
export async function generateBadge({ redis, config }: AppDependencies): Promise<void> {
  try {
    const keys = await getUserKeys(redis)
    const total = keys.length

    if (total === 0) {
      await redis.set(CACHED_TELEMETRY_KEY, JSON.stringify({ total: 0, versions: [] }))
    } else {
      const versions = await Promise.all(keys.map((key) => redis.get(key)))
      const versionCounts = versions.reduce(
        (acc, version) => {
          if (version) {
            acc[version] = (acc[version] || 0) + 1
          }
          return acc
        },
        {} as Record<string, number>,
      )
      const versionsList = Object.entries(versionCounts)
        .map(([version, count]) => ({ version, count }))
        .sort((a, b) => compareVersionsDescending(a.version, b.version))
      await redis.set(CACHED_TELEMETRY_KEY, JSON.stringify({ total, versions: versionsList }))
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

export function createApp(deps: AppDependencies): Express {
  const { redis, config } = deps
  const rateLimitWindowSeconds = Math.ceil(config.rateLimitWindowMs / 1000)
  const app = express()

  // Security headers — applied first so every response, including health endpoints, carries them
  app.use(helmet())

  // Only trust proxy headers when explicitly configured. When false (default),
  // Express will not populate req.ip from X-Forwarded-For, and getClientIp
  // will use the raw TCP source address to prevent rate-limit header spoofing.
  if (config.behindProxy) {
    app.set('trust proxy', 1)
  }
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

  async function enforceRateLimitRedis(key: string, max: number, res: Response): Promise<boolean> {
    try {
      const redisKey = `ratelimit:${key}`
      const count = await redis.incr(redisKey)

      if (count === 1) {
        await redis.expire(redisKey, rateLimitWindowSeconds)
      }

      if (count > max) {
        res.set('Retry-After', String(rateLimitWindowSeconds))
        res.status(429).json({ error: 'Too many requests' })
        return false
      }

      return true
    } catch (error) {
      // Fail open — if Redis is unavailable, allow the request
      console.error('Rate limit check failed:', error)
      return true
    }
  }

  async function rateLimitByIp(req: Request, res: Response, next: () => void) {
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
      const { userHash, version } = req.body as { userHash?: unknown; version?: unknown }

      // Hash rate limit before any validation (use IP-based fallback when userHash is not a string)
      const hashKey =
        typeof userHash === 'string' && userHash
          ? `hash:${userHash}`
          : `hash:unknown-${hashIp(getClientIp(req, config.behindProxy), config.rateLimitSalt)}`
      if (!(await enforceRateLimitRedis(hashKey, config.rateLimitHashMax, res))) {
        return
      }

      if (typeof userHash !== 'string' || !userHash || typeof version !== 'string' || !version) {
        return res.status(400).json({ error: 'userHash and version are required' })
      }

      // Ignore test data
      if (userHash.includes('test-hash')) {
        return res.json({ success: true, message: 'Test data ignored' })
      }

      const validationError = validateTelemetryPayload(userHash, version)
      if (validationError) {
        return res.status(400).json({ error: validationError })
      }

      // Store in Redis with 24-hour TTL
      const key = `user:${userHash}`
      await redis.setEx(key, USER_TTL_SECONDS, version)

      // Regenerate badge with updated count
      await generateBadge(deps)

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
      res.json(cached ? JSON.parse(cached) : { total: 0, versions: [] })
    } catch (error) {
      console.error('Error fetching telemetry:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return app
}

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express, { type Request, type Response } from 'express'
import { createClient } from 'redis'

const app = express()
const port = process.env.PORT || 3001

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000)
const RATE_LIMIT_IP_MAX = Number(process.env.RATE_LIMIT_IP_MAX || 10)
const RATE_LIMIT_HASH_MAX = Number(process.env.RATE_LIMIT_HASH_MAX || 1)
function readMachineId(): string | null {
  const paths = ['/etc/machine-id', '/var/lib/dbus/machine-id']
  for (const filePath of paths) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8').trim()
      }
    } catch {
      // ignore and try next path
    }
  }
  return null
}

const RATE_LIMIT_SALT = process.env.RATE_LIMIT_SALT || readMachineId() || os.hostname()

// Respect proxy headers (e.g., X-Forwarded-For) when behind a reverse proxy
app.set('trust proxy', 1)

// Redis client setup
const redis = createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
})

redis.on('error', (err: Error) => console.error('Redis Client Error', err))

await redis.connect()

app.use(express.json({ limit: '10kb' }))

const RATE_LIMIT_WINDOW_SECONDS = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)

function hashIp(ip: string): string {
  return crypto.createHmac('sha256', RATE_LIMIT_SALT).update(ip).digest('hex')
}

function getClientIp(req: Request): string {
  const xRealIp = req.get('X-Real-IP')
  if (xRealIp) return xRealIp
  return req.ip || 'unknown'
}

async function enforceRateLimitRedis(key: string, max: number, res: Response): Promise<boolean> {
  try {
    const redisKey = `ratelimit:${key}`
    const count = await redis.incr(redisKey)

    if (count === 1) {
      await redis.expire(redisKey, RATE_LIMIT_WINDOW_SECONDS)
    }

    if (count > max) {
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
  const ip = getClientIp(req)
  const ipKey = `ip:${hashIp(ip)}`
  if (!(await enforceRateLimitRedis(ipKey, RATE_LIMIT_IP_MAX, res))) {
    return
  }
  return next()
}

function validateTelemetryPayload(userHash: unknown, version: unknown): string | null {
  if (typeof userHash !== 'string' || typeof version !== 'string') {
    return 'userHash and version must be strings'
  }

  if (userHash.length < 32 || userHash.length > 128) {
    return 'userHash length is invalid'
  }

  if (!/^[a-f0-9]+$/i.test(userHash)) {
    return 'userHash must be hex'
  }

  if (version.length < 1 || version.length > 32) {
    return 'version length is invalid'
  }

  if (!/^[a-z0-9._-]+$/i.test(version)) {
    return 'version contains invalid characters'
  }

  return null
}

async function getUserKeys(): Promise<string[]> {
  const keys: string[] = []
  for await (const key of redis.scanIterator({ MATCH: 'user:*', COUNT: 1000 })) {
    keys.push(String(key))
  }
  return keys
}

// Update the telemetry cache in Redis and write the badge SVG file.
// The cache update runs first so GET /telemetry works even when the
// badge file write fails (e.g. read-only filesystem / non-root user).
async function generateBadge(): Promise<void> {
  try {
    const keys = await getUserKeys()
    const total = keys.length

    // Update cached telemetry in Redis (must succeed for GET /telemetry)
    if (total === 0) {
      await redis.set('cached:telemetry', JSON.stringify({ total: 0, versions: [] }))
    } else {
      const versions = await Promise.all(keys.map((key: string) => redis.get(key)))
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
        .sort((a, b) => {
          const partsA = a.version.replace(/^v/, '').split('.').map(Number)
          const partsB = b.version.replace(/^v/, '').split('.').map(Number)
          for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
            const diff = (partsB[i] || 0) - (partsA[i] || 0)
            if (diff !== 0) return diff
          }
          return 0
        })
      await redis.set('cached:telemetry', JSON.stringify({ total, versions: versionsList }))
    }

    // Write badge SVG file (best-effort — may fail on read-only filesystems)
    try {
      const badgePath = path.join(process.cwd(), 'badge', 'users.svg')
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20">
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
      await fsp.mkdir(path.dirname(badgePath), { recursive: true })
      await fsp.writeFile(badgePath, svg)
    } catch {
      // Badge file write is non-critical — the SVG is served via a
      // Docker volume or reverse proxy, so it may not be writable here.
    }

    console.log(`Telemetry cache updated: ${total} users`)
  } catch (error) {
    console.error('Error updating telemetry cache:', error)
  }
}

// POST /telemetry - Store user telemetry data
// Rate limiting runs BEFORE validation — malformed requests must still consume quota.
app.post('/telemetry', rateLimitByIp, async (req: Request, res: Response) => {
  try {
    const { userHash, version }: { userHash: string; version: string } = req.body

    // Hash rate limit before any validation (use IP-based fallback when userHash is missing)
    const hashKey = userHash ? `hash:${userHash}` : `hash:unknown-${hashIp(getClientIp(req))}`
    if (!(await enforceRateLimitRedis(hashKey, RATE_LIMIT_HASH_MAX, res))) {
      return
    }

    if (!userHash || !version) {
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
    await redis.setEx(key, 24 * 60 * 60, version)

    // Regenerate badge with updated count
    await generateBadge()

    res.json({ success: true })
  } catch (error) {
    console.error('Error storing telemetry:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /telemetry - Get aggregated telemetry data (read-only)
app.get('/telemetry', async (_req: Request, res: Response) => {
  try {
    const cached = await redis.get('cached:telemetry')
    res.json(cached ? JSON.parse(cached) : { total: 0, versions: [] })
  } catch (error) {
    console.error('Error fetching telemetry:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.listen(port, () => {
  console.log(`Telemetry server running on port ${port}`)
  // Generate initial badge on startup
  generateBadge()
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server')
  await redis.quit()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server')
  await redis.quit()
  process.exit(0)
})

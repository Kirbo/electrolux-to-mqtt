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

app.use(express.json())

type RateLimitEntry = {
  count: number
  resetAt: number
}

const ipRateLimitStore = new Map<string, RateLimitEntry>()
const hashRateLimitStore = new Map<string, RateLimitEntry>()

function hashIp(ip: string): string {
  return crypto.createHmac('sha256', RATE_LIMIT_SALT).update(ip).digest('hex')
}

function enforceRateLimit(key: string, store: Map<string, RateLimitEntry>, max: number, res: Response): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }

  if (entry.count >= max) {
    res.status(429).json({ error: 'Too many requests' })
    return false
  }

  entry.count += 1
  return true
}

function rateLimitByIp(req: Request, res: Response, next: () => void) {
  const now = Date.now()
  void now
  const ip = req.ip || 'unknown'
  const ipKey = `ip:${hashIp(ip)}`
  if (!enforceRateLimit(ipKey, ipRateLimitStore, RATE_LIMIT_IP_MAX, res)) {
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

// Badge generation function
async function generateBadge(): Promise<void> {
  try {
    // Get total user count
    const keys = await getUserKeys()
    const total = keys.length

    const badgePath = path.join(process.cwd(), 'badge', 'users.svg')

    // Generate SVG badge
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20">
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
</svg>`.trim()

    // Ensure badge directory exists
    await fsp.mkdir(path.dirname(badgePath), { recursive: true })

    // Write SVG to disk
    await fsp.writeFile(badgePath, svg)

    console.log(`Badge updated: ${total} users`)
  } catch (error) {
    console.error('Error generating badge:', error)
  }
}

// POST /telemetry - Store user telemetry data
app.post('/telemetry', rateLimitByIp, async (req: Request, res: Response) => {
  try {
    const { userHash, version }: { userHash: string; version: string } = req.body

    if (!userHash || !version) {
      return res.status(400).json({ error: 'userHash and version are required' })
    }

    if (!enforceRateLimit(`hash:${userHash}`, hashRateLimitStore, RATE_LIMIT_HASH_MAX, res)) {
      return
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

// GET /telemetry - Get aggregated telemetry data
app.get('/telemetry', async (_req: Request, res: Response) => {
  try {
    const cached = await redis.get('cached:telemetry')
    if (cached) {
      return res.json(JSON.parse(cached))
    }

    // Get all user keys
    const keys = await getUserKeys()
    const total = keys.length

    if (total === 0) {
      const emptyResponse = { total: 0, versions: [] }
      await redis.setEx('cached:telemetry', 5 * 60, JSON.stringify(emptyResponse))
      return res.json(emptyResponse)
    }

    // Get all versions
    const versions = await Promise.all(keys.map((key: string) => redis.get(key)))

    // Count versions
    const versionCounts = versions.reduce(
      (acc, version) => {
        if (version) {
          acc[version] = (acc[version] || 0) + 1
        }
        return acc
      },
      {} as Record<string, number>,
    )

    // Format response — sort by semantic version descending
    const versionsList = Object.entries(versionCounts)
      .map(([version, count]) => ({
        version,
        count,
      }))
      .sort((a, b) => {
        const partsA = a.version.replace(/^v/, '').split('.').map(Number)
        const partsB = b.version.replace(/^v/, '').split('.').map(Number)
        for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
          const diff = (partsB[i] || 0) - (partsA[i] || 0)
          if (diff !== 0) return diff
        }
        return 0
      })

    const responsePayload = {
      total,
      versions: versionsList,
    }

    await redis.setEx('cached:telemetry', 5 * 60, JSON.stringify(responsePayload))
    res.json(responsePayload)
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

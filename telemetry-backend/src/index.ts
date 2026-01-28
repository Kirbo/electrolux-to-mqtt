import fs from 'node:fs/promises'
import path from 'node:path'
import express, { type Request, type Response } from 'express'
import { createClient } from 'redis'

const app = express()
const port = process.env.PORT || 3001

// Redis client setup
const redis = createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
})

redis.on('error', (err: Error) => console.error('Redis Client Error', err))

await redis.connect()

app.use(express.json())

// Badge generation function
async function generateBadge(): Promise<void> {
  try {
    // Get total user count
    const keys = await redis.keys('user:*')
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
    await fs.mkdir(path.dirname(badgePath), { recursive: true })

    // Write SVG to disk
    await fs.writeFile(badgePath, svg)

    console.log(`Badge updated: ${total} users`)
  } catch (error) {
    console.error('Error generating badge:', error)
  }
}

// POST /telemetry - Store user telemetry data
app.post('/telemetry', async (req: Request, res: Response) => {
  try {
    const { userHash, version } = req.body

    if (!userHash || !version) {
      return res.status(400).json({ error: 'userHash and version are required' })
    }

    // Ignore test data
    if (userHash === 'test-hash-123') {
      return res.json({ success: true, message: 'Test data ignored' })
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
    // Get all user keys
    const keys = await redis.keys('user:*')
    const total = keys.length

    if (total === 0) {
      return res.json({ total: 0, versions: [] })
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

    // Format response
    const versionsList = Object.entries(versionCounts)
      .map(([version, count]) => ({
        version,
        count,
      }))
      .sort((a, b) => b.count - a.count)

    res.json({
      total,
      versions: versionsList,
    })
  } catch (error) {
    console.error('Error fetching telemetry:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /badge - Serve the badge image
// app.get('/badge', async (_req: Request, res: Response) => {
//   try {
//     const badgePath = path.join(process.cwd(), 'badge', 'users.svg')

//     // Check if badge exists, if not generate it
//     try {
//       await fs.access(badgePath)
//     } catch {
//       await generateBadge()
//     }

//     // Read and serve the SVG
//     const svg = await fs.readFile(badgePath, 'utf-8')

//     res.setHeader('Content-Type', 'image/svg+xml')
//     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
//     res.send(svg)
//   } catch (error) {
//     console.error('Error serving badge:', error)
//     res.status(500).json({ error: 'Internal server error' })
//   }
// })

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

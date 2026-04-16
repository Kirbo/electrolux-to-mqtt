import os from 'node:os'
import path from 'node:path'
import { createClient } from 'redis'
import { type AppConfig, createApp, generateBadge, type RedisLike } from './app.js'
import { readMachineId } from './utils.js'

const port = process.env.PORT || 3001

const config: AppConfig = {
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  rateLimitIpMax: Number(process.env.RATE_LIMIT_IP_MAX || 10),
  rateLimitHashMax: Number(process.env.RATE_LIMIT_HASH_MAX || 1),
  rateLimitSalt: process.env.RATE_LIMIT_SALT || readMachineId() || os.hostname(),
  badgeDir: path.join(process.cwd(), 'badge'),
  // Trust reverse-proxy headers (X-Forwarded-For) only when TELEMETRY_BEHIND_PROXY
  // is explicitly set to a truthy string. Default false to prevent rate-limit bypass
  // when the backend is exposed directly to the internet without a fronting proxy.
  behindProxy: ['true', '1', 'yes'].includes((process.env.TELEMETRY_BEHIND_PROXY ?? '').toLowerCase()),
}

// Redis client setup
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
})

redisClient.on('error', (err: Error) => console.error('Redis Client Error', err))

await redisClient.connect()

// Narrow adapter exposing only the methods the app uses. Avoids coupling
// app.ts to the full node-redis client type and makes the type surface
// testable with an in-memory fake.
const redis: RedisLike = {
  incr: (key) => redisClient.incr(key),
  expire: (key, seconds) => redisClient.expire(key, seconds),
  get: (key) => redisClient.get(key),
  set: (key, value) => redisClient.set(key, value),
  setEx: (key, seconds, value) => redisClient.setEx(key, seconds, value),
  scanIterator: (options) => redisClient.scanIterator(options),
}

const app = createApp({ redis, config })

app.listen(port, () => {
  console.log(`Telemetry server running on port ${port}`)
  // Generate initial badge on startup
  generateBadge({ redis, config })
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server')
  await redisClient.quit()
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server')
  await redisClient.quit()
  process.exit(0)
})

import os from 'node:os'
import path from 'node:path'
import { createClient, type RedisClientType } from 'redis'
import { type AppConfig, createApp, generateBadge, type RedisLike } from './app.js'
import { buildRateLimitSalt, createShutdownHandler, DEFAULT_SHUTDOWN_TIMEOUT_MS } from './startup.js'
import { readMachineId } from './utils.js'

const port = process.env.PORT || 3001

const rateLimitSalt = buildRateLimitSalt({
  env: process.env,
  machineId: readMachineId(),
  hostname: os.hostname(),
  nodeEnv: process.env.NODE_ENV ?? '',
})

const config: AppConfig = {
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  rateLimitIpMax: Number(process.env.RATE_LIMIT_IP_MAX || 10),
  rateLimitHashMax: Number(process.env.RATE_LIMIT_HASH_MAX || 1),
  rateLimitSalt,
  badgeDir: path.join(process.cwd(), 'badge'),
  // Trust reverse-proxy headers (X-Forwarded-For) only when TELEMETRY_BEHIND_PROXY
  // is explicitly set to a truthy string. Default false to prevent rate-limit bypass
  // when the backend is exposed directly to the internet without a fronting proxy.
  behindProxy: ['true', '1', 'yes'].includes((process.env.TELEMETRY_BEHIND_PROXY ?? '').toLowerCase()),
  rateLimitBreakerThreshold: Number(process.env.RATE_LIMIT_BREAKER_THRESHOLD || 5),
  rateLimitBreakerWindowMs: Number(process.env.RATE_LIMIT_BREAKER_WINDOW_MS || 60_000),
  rateLimitBreakerCooldownMs: Number(process.env.RATE_LIMIT_BREAKER_COOLDOWN_MS || 30_000),
}

// Redis client setup
const redisClient: RedisClientType = createClient({
  url: process.env.REDIS_URL || 'redis://redis:6379',
})

redisClient.on('error', (err: Error) => console.error('Redis Client Error', err))

await redisClient.connect()

// Lua script for atomic INCR + conditional PEXPIRE on first creation.
// Returns the new counter value. One round-trip, no race window.
const LUA_INCR_WITH_TTL = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`

// Narrow adapter exposing only the methods the app uses. Avoids coupling
// app.ts to the full node-redis client type and makes the type surface
// testable with an in-memory fake.
const redis: RedisLike = {
  incrWithTtl: async (key: string, ttlMs: number): Promise<number> => {
    const result = await redisClient.eval(LUA_INCR_WITH_TTL, {
      keys: [key],
      arguments: [String(ttlMs)],
    })
    if (typeof result !== 'number') throw new Error(`Lua script returned non-number: ${typeof result}`)
    return result
  },
  get: (key) => redisClient.get(key),
  set: (key, value) => redisClient.set(key, value),
  setEx: (key, seconds, value) => redisClient.setEx(key, seconds, value),
  scanIterator: (options) => redisClient.scanIterator(options),
}

const app = createApp({ redis, config })

const server = app.listen(port, () => {
  console.log(`Telemetry server running on port ${port}`)
  // Generate initial badge on startup
  generateBadge({ redis, config })
})

const shutdown = createShutdownHandler(server, redisClient, {
  timeoutMs: DEFAULT_SHUTDOWN_TIMEOUT_MS,
  exit: (code) => process.exit(code),
})

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server')
  shutdown()
})

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server')
  shutdown()
})

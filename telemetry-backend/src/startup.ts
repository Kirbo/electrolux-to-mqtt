import type { Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { createClient, type RedisClientType } from 'redis'
import type { AppConfig, RedisLike } from './app.js'
import { readMachineId } from './utils.js'

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000

/**
 * Parse a numeric environment value, falling back to `fallback` when it is
 * unset, empty, or non-numeric. A present-but-invalid value (e.g. a typo) is
 * warned about rather than silently producing NaN, which would degrade the
 * rate limiter without any signal.
 */
export function envNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    console.warn(`[telemetry] WARN: expected a number but got "${value}"; using fallback ${fallback}.`)
    return fallback
  }
  return parsed
}

/**
 * Resolve the rate-limit salt from the environment.
 * In production, refuses to start when no reliable unique identifier is
 * available (RATE_LIMIT_SALT env unset AND no /etc/machine-id readable).
 * Outside production, falls back to hostname with a warning.
 */
export function buildRateLimitSalt(opts: {
  env: NodeJS.ProcessEnv
  machineId: string | null
  hostname: string
  nodeEnv: string
}): string {
  const { env, machineId, hostname, nodeEnv } = opts

  if (env.RATE_LIMIT_SALT) {
    return env.RATE_LIMIT_SALT
  }

  if (machineId) {
    return machineId
  }

  if (nodeEnv === 'production') {
    process.stderr.write(
      '[telemetry] FATAL: RATE_LIMIT_SALT env is unset and /etc/machine-id is not readable. ' +
        'Set RATE_LIMIT_SALT to a secret random value before starting in production.\n',
    )
    process.exit(1)
  }

  // Non-production: hostname fallback with visible warning
  console.warn(
    '[telemetry] WARN: RATE_LIMIT_SALT is unset and /etc/machine-id is unavailable. ' +
      'Falling back to hostname. Set RATE_LIMIT_SALT in production.',
  )
  return hostname
}

// Lua script for atomic INCR + conditional PEXPIRE on first creation.
// Returns the new counter value. One round-trip, no race window.
const LUA_INCR_WITH_TTL = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`

/**
 * Build the application config from environment variables. Uses the same
 * defaults and derivation logic as the server entry point — both `index.ts`
 * and `regenerate-badges.ts` call this so they can never drift.
 */
export function createConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rateLimitSalt = buildRateLimitSalt({
    env,
    machineId: readMachineId(),
    hostname: os.hostname(),
    nodeEnv: env.NODE_ENV ?? '',
  })

  return {
    rateLimitWindowMs: envNumber(env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitIpMax: envNumber(env.RATE_LIMIT_IP_MAX, 10),
    rateLimitHashMax: envNumber(env.RATE_LIMIT_HASH_MAX, 1),
    rateLimitSalt,
    badgeDir: path.join(process.cwd(), 'badge'),
    behindProxy: ['true', '1', 'yes'].includes((env.TELEMETRY_BEHIND_PROXY ?? '').toLowerCase()),
    rateLimitBreakerThreshold: envNumber(env.RATE_LIMIT_BREAKER_THRESHOLD, 5),
    rateLimitBreakerWindowMs: envNumber(env.RATE_LIMIT_BREAKER_WINDOW_MS, 60_000),
    rateLimitBreakerCooldownMs: envNumber(env.RATE_LIMIT_BREAKER_COOLDOWN_MS, 30_000),
    releasesApiUrl: 'https://gitlab.com/api/v4/projects/kirbo%2Felectrolux-to-mqtt/releases',
    releasesPageUrl: 'https://gitlab.com/kirbo/electrolux-to-mqtt/-/releases',
  }
}

/**
 * Create and connect a Redis client, wrapped in the `RedisLike` adapter that
 * the app and badge functions consume. Returns both the raw client (needed for
 * shutdown `.quit()`) and the adapter. Both `index.ts` and
 * `regenerate-badges.ts` call this so the Lua wiring can never drift.
 */
export async function createRedisClient(
  redisUrl: string = process.env.REDIS_URL ?? 'redis://redis:6379',
): Promise<{ redisClient: RedisClientType; redis: RedisLike }> {
  const redisClient: RedisClientType = createClient({ url: redisUrl })

  redisClient.on('error', (err: Error) => console.error('Redis Client Error', err))

  await redisClient.connect()

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

  return { redisClient, redis }
}

/**
 * Creates a graceful shutdown handler that drains in-flight HTTP requests,
 * closes the Redis client, then calls the exit hook.
 *
 * @param server     - The HTTP Server instance to drain.
 * @param redisClient - Redis client to quit after the server closes.
 * @param opts.timeoutMs - Hard timeout before forcing exit (default 15 s).
 * @param opts.exit      - Exit hook (injected so tests don't call process.exit).
 */
export function createShutdownHandler(
  server: Server,
  redisClient: { quit: () => Promise<unknown> },
  opts: { timeoutMs?: number; exit: (code: number) => void },
): () => Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS
  return async () => {
    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()))
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('shutdown timeout')), timeoutMs)),
      ])
      await redisClient.quit()
      opts.exit(0)
    } catch (err) {
      console.error('Error during shutdown:', err)
      opts.exit(1)
    }
  }
}

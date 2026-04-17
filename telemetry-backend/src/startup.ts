import type { Server } from 'node:http'

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000

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

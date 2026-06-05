import { createApp, generateBadge, generateReleaseBadges } from './app.js'
import { createConfig, createRedisClient, createShutdownHandler, DEFAULT_SHUTDOWN_TIMEOUT_MS } from './startup.js'

const port = process.env.PORT || 3001

const config = createConfig()
const { redisClient, redis } = await createRedisClient()

const app = createApp({ redis, config })

const server = app.listen(port, () => {
  console.log(`Telemetry server running on port ${port}`)
  // Generate initial badges on startup
  generateBadge({ redis, config })
  generateReleaseBadges({ config, redis }).catch((err: unknown) => {
    console.error('Release badge generation failed:', err)
  })
})

// Refresh release badges every 10 minutes. unref() so the interval does not
// prevent the process from exiting cleanly when shutdown is requested.
setInterval(() => {
  generateReleaseBadges({ config, redis }).catch((err: unknown) => {
    console.error('Release badge generation failed:', err)
  })
}, 600_000).unref()

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

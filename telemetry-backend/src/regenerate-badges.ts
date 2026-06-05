/**
 * One-shot badge regeneration script.
 *
 * Intended to be run via `docker compose exec -T telemetry-backend node dist/regenerate-badges.js`
 * after a new release is published to GitLab, so badges reflect the new version
 * without waiting for the next periodic refresh in the server.
 *
 * This is a composition root — intentionally thin and untested. All logic lives
 * in the tested modules it calls (createConfig, createRedisClient, generateBadge,
 * generateReleaseBadges in app.ts).
 */
import { generateBadge, generateReleaseBadges } from './app.js'
import { createConfig, createRedisClient } from './startup.js'

const config = createConfig()
const { redisClient, redis } = await createRedisClient()

try {
  await generateBadge({ redis, config })
  await generateReleaseBadges({ config, redis })
  await redisClient.quit()
  process.exit(0)
} catch (err) {
  console.error('Badge regeneration failed:', err)
  await redisClient.quit().catch(() => {})
  process.exit(1)
}

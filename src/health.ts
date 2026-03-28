import fs from 'node:fs'
import config from './config.js'
import createLogger from './logger.js'

const logger = createLogger('health')

const healthFilePath = config.healthCheck?.filePath ?? '/tmp/e2m-health'
const healthEnabled = config.healthCheck?.enabled ?? false

interface HealthStatus {
  mqttConnected: boolean
}

/**
 * Write the current Unix timestamp to the health file.
 * Called after each successful state poll cycle.
 * Skips writing if MQTT is disconnected, so the health file goes stale
 * and Docker HEALTHCHECK will eventually mark the container as unhealthy.
 */
export function writeHealthFile(status?: HealthStatus): void {
  if (!healthEnabled) return
  if (status && !status.mqttConnected) return
  try {
    fs.writeFileSync(healthFilePath, String(Math.floor(Date.now() / 1000)), 'utf8')
  } catch (error) {
    logger.warn('Failed to write health file:', error)
  }
}

/**
 * Check if the health file exists and is recent.
 * @param maxAgeSeconds Maximum age of the health file in seconds
 */
export function isHealthy(maxAgeSeconds: number): boolean {
  try {
    const content = fs.readFileSync(healthFilePath, 'utf8')
    const timestamp = Number.parseInt(content, 10)
    const age = Math.floor(Date.now() / 1000) - timestamp
    return age < maxAgeSeconds
  } catch {
    return false
  }
}

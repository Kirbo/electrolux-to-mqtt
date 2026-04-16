import crypto from 'node:crypto'
import packageJson from '../package.json' with { type: 'json' }
import config from './config.js'
import { ElectroluxClient } from './electrolux.js'
import createLogger from './logger.js'
import Mqtt from './mqtt.js'
import { Orchestrator } from './orchestrator.js'
import { startVersionChecker } from './version-checker.js'

const currentVersion = packageJson.version
const logger = createLogger('app')
logger.info({ version: currentVersion }, 'Starting Electrolux to MQTT')
const mqtt = new Mqtt()
const client = new ElectroluxClient(mqtt)

// Salt derived from partial config values, then hashed — unique per installation,
// resistant to rainbow tables and not reversible to the original config fragments.
const telemetrySalt = crypto
  .createHash('sha256')
  .update([config.mqtt.url.slice(-8), config.mqtt.username.slice(0, 4), config.electrolux.countryCode].join(':'))
  .digest('hex')
const userHash = crypto.createHmac('sha256', telemetrySalt).update(config.electrolux.username).digest('hex')

const refreshInterval = (client.refreshInterval ?? 60) * 1000
const applianceDiscoveryInterval = (config.electrolux.applianceDiscoveryInterval ?? 300) * 1000

const orchestrator = new Orchestrator(client, mqtt, {
  refreshInterval,
  applianceDiscoveryInterval,
  autoDiscovery: config.homeAssistant.autoDiscovery,
  apiFailureRestartThresholdMs: (config.healthCheck.unHealthyRestartMinutes ?? 45) * 60_000,
  healthCheckEnabled: config.healthCheck.enabled,
})

let discoveryInterval: NodeJS.Timeout | null = null
let stopVersionChecker: (() => void) | null = null
let restartTimeout: NodeJS.Timeout | null = null

// Graceful shutdown handler
const shutdown = async () => {
  if (restartTimeout !== null) {
    clearTimeout(restartTimeout)
    restartTimeout = null
  }
  orchestrator.shutdown(stopVersionChecker, discoveryInterval)
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Wait for client login — login() has its own exponential backoff retry
const waitForLogin = async () => {
  if (!client.isLoggingIn) {
    await client.login()
  }
  await client.waitForLogin()
}

const main = async () => {
  logger.info(`Appliance refresh interval set to: ${refreshInterval / 1000} seconds`)

  // Initialize the client
  await client.initialize()
  await waitForLogin()

  // Initial appliance discovery
  const appliances = await client.getAppliances()

  if (!appliances) {
    // API call failed (network error, DNS failure, etc.)
    logger.error(`Failed to fetch appliances due to API error. Retrying in ${refreshInterval / 1000} seconds...`)
    if (!orchestrator.isShuttingDown) {
      restartTimeout = setTimeout(() => {
        main().catch((err: unknown) => logger.error('Error in restart:', err))
      }, refreshInterval)
    }
    return
  }

  if (appliances.length === 0) {
    logger.error(
      `No appliances found. Please check your configuration and ensure you have appliances registered in Electrolux Mobile App. Retrying in ${refreshInterval / 1000} seconds...`,
    )
    if (!orchestrator.isShuttingDown) {
      restartTimeout = setTimeout(() => {
        main().catch((err: unknown) => logger.error('Error in restart:', err))
      }, refreshInterval)
    }
    return
  }

  logger.info(`Found ${appliances.length} appliance(s), initializing...`)

  const totalAppliances = appliances.length
  const intervalDelay = refreshInterval / totalAppliances

  // Initialize all appliances with staggered delays
  for (const [i, appliance] of appliances.entries()) {
    const delay = i * intervalDelay
    await orchestrator.initializeAppliance(appliance, delay)
  }

  // Start periodic appliance discovery
  discoveryInterval = setInterval(() => {
    if (orchestrator.isShuttingDown) {
      if (discoveryInterval) clearInterval(discoveryInterval)
      return
    }
    orchestrator.discoverAppliances()
  }, applianceDiscoveryInterval)

  logger.info(`Appliance discovery running every ${applianceDiscoveryInterval / 1000 / 60} minutes to detect changes`)

  // Start version checker
  stopVersionChecker = startVersionChecker(currentVersion, userHash, mqtt)
}

try {
  await main()
} catch (err: unknown) {
  logger.error('Fatal error in main:', err)
}

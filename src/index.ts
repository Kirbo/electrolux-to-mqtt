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
const mqtt = new Mqtt()
const client = new ElectroluxClient(mqtt)

// Generate anonymous user hash for telemetry (irreversible SHA-256)
const userHash = crypto.createHash('sha256').update(config.electrolux.username).digest('hex')

const refreshInterval = (client.refreshInterval ?? 60) * 1000
const applianceDiscoveryInterval = (config.electrolux.applianceDiscoveryInterval ?? 300) * 1000

const orchestrator = new Orchestrator(client, mqtt, {
  refreshInterval,
  applianceDiscoveryInterval,
  autoDiscovery: config.homeAssistant.autoDiscovery,
})

let discoveryInterval: NodeJS.Timeout | null = null
let stopVersionChecker: (() => void) | null = null

// Graceful shutdown handler
const shutdown = async () => {
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
      setTimeout(() => main(), refreshInterval)
    }
    return
  }

  if (appliances.length === 0) {
    logger.error(
      `No appliances found. Please check your configuration and ensure you have appliances registered in Electrolux Mobile App. Retrying in ${refreshInterval / 1000} seconds...`,
    )
    if (!orchestrator.isShuttingDown) {
      setTimeout(() => main(), refreshInterval)
    }
    return
  }

  logger.info(`Found ${appliances.length} appliance(s), initializing...`)

  const totalAppliances = appliances.length
  const intervalDelay = refreshInterval / totalAppliances

  // Initialize all appliances with staggered delays
  for (let i = 0; i < appliances.length; i++) {
    const delay = i * intervalDelay
    await orchestrator.initializeAppliance(appliances[i], delay)
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

main()

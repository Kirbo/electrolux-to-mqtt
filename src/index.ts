import crypto from 'node:crypto'
import packageJson from '../package.json' with { type: 'json' }
import config from './config.js'
import { disposableInterval, disposableTimeout } from './disposable.js'
import { ElectroluxClient } from './electrolux.js'
import { LivestreamClient } from './livestream.js'
import createLogger from './logger.js'
import { runStartupMigrations } from './migrate.js'
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

const safetyRefreshIntervalMs = config.electrolux.safetyRefreshInterval * 1000
const applianceDiscoveryIntervalMs = config.electrolux.applianceDiscoveryInterval * 1000
const idleTimeoutMs = config.electrolux.livestreamIdleTimeoutSeconds * 1000
const reconnectMaxMs = config.electrolux.livestreamReconnectMaxSeconds * 1000

const livestream = new LivestreamClient(client, {
  idleTimeoutMs,
  reconnectMaxMs,
})

const orchestrator = new Orchestrator(client, mqtt, {
  applianceDiscoveryInterval: applianceDiscoveryIntervalMs,
  autoDiscovery: config.homeAssistant.autoDiscovery,
  apiFailureRestartThresholdMs: config.healthCheck.unHealthyRestartMinutes * 60_000,
  healthCheckEnabled: config.healthCheck.enabled,
  applianceRemovalGracePeriodMs: config.electrolux.applianceRemovalGracePeriodMinutes * 60_000,
  haBirthRepublish: config.homeAssistant.birthRepublish,
  haBirthTopic: config.homeAssistant.statusTopic,
  haBirthPayload: config.homeAssistant.birthPayload,
  idleTimeoutMs,
})

let discoveryIntervalDisposable: Disposable | null = null
let safetyRefreshIntervalDisposable: Disposable | null = null
let stopVersionChecker: (() => void) | null = null
let restartTimeoutDisposable: Disposable | null = null

// Graceful shutdown handler
const shutdown = async () => {
  restartTimeoutDisposable?.[Symbol.dispose]()
  restartTimeoutDisposable = null
  discoveryIntervalDisposable?.[Symbol.dispose]()
  discoveryIntervalDisposable = null
  safetyRefreshIntervalDisposable?.[Symbol.dispose]()
  safetyRefreshIntervalDisposable = null
  if (stopVersionChecker) stopVersionChecker()
  // Stop the stream before shutting down the orchestrator so cleanup is orderly
  await livestream[Symbol.asyncDispose]()
  orchestrator.shutdown()
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

export const main = async () => {
  await runStartupMigrations()
  logger.info(`Safety refresh interval set to: ${safetyRefreshIntervalMs / 1000} seconds`)

  // Initialize the client
  await client.initialize()
  await waitForLogin()

  // Initial appliance discovery
  const appliances = await client.getAppliances()

  if (!appliances) {
    // API call failed (network error, DNS failure, etc.)
    logger.error(
      `Failed to fetch appliances due to API error. Retrying in ${safetyRefreshIntervalMs / 1000} seconds...`,
    )
    if (!orchestrator.isShuttingDown) {
      restartTimeoutDisposable = disposableTimeout(() => {
        restartTimeoutDisposable = null
        main().catch((err: unknown) => logger.error('Error in restart:', err))
      }, safetyRefreshIntervalMs)
    }
    return
  }

  if (appliances.length === 0) {
    logger.error(
      `No appliances found. Please check your configuration and ensure you have appliances registered in Electrolux Mobile App. Retrying in ${safetyRefreshIntervalMs / 1000} seconds...`,
    )
    if (!orchestrator.isShuttingDown) {
      restartTimeoutDisposable = disposableTimeout(() => {
        restartTimeoutDisposable = null
        main().catch((err: unknown) => logger.error('Error in restart:', err))
      }, safetyRefreshIntervalMs)
    }
    return
  }

  logger.info(`Found ${appliances.length} appliance(s), initializing...`)

  // Initialize all appliances (no stagger delay needed — initial seeds fire async)
  for (const appliance of appliances) {
    await orchestrator.initializeAppliance(appliance)
  }

  // Wire and start the SSE livestream
  orchestrator.initializeLivestream(livestream)

  // Periodic safety refresh: re-seed all appliances to close drift regardless of stream activity.
  // This is independent of stream reconnects (which also trigger reseeds) and runs infrequently
  // (default 6h) as a backstop for any state drift that accumulates over long idle periods.
  safetyRefreshIntervalDisposable = disposableInterval(() => {
    if (orchestrator.isShuttingDown) {
      safetyRefreshIntervalDisposable?.[Symbol.dispose]()
      safetyRefreshIntervalDisposable = null
      return
    }
    for (const appliance of orchestrator.getApplianceInstances().values()) {
      client
        .reseedApplianceState(appliance)
        .catch((err: unknown) => logger.error('Error in safety refresh reseed:', err))
    }
  }, safetyRefreshIntervalMs)

  // Start periodic appliance discovery
  discoveryIntervalDisposable = disposableInterval(() => {
    if (orchestrator.isShuttingDown) {
      discoveryIntervalDisposable?.[Symbol.dispose]()
      discoveryIntervalDisposable = null
      return
    }
    orchestrator.discoverAppliances()
  }, applianceDiscoveryIntervalMs)

  logger.info(`Appliance discovery running every ${applianceDiscoveryIntervalMs / 1000 / 60} minutes to detect changes`)

  // Start version checker.
  // process.env.E2M_IMAGE_CHANNEL is baked into the Docker image at build time (UPDATE_CHANNEL ARG).
  // It is NOT routed through config.ts so it is honoured in YAML-config mode too.
  stopVersionChecker = startVersionChecker(currentVersion, userHash, mqtt, process.env.E2M_IMAGE_CHANNEL)
}

if (process.env.VITEST !== 'true') {
  try {
    await main()
  } catch (err: unknown) {
    logger.error('Fatal error in main:', err)
  }
}

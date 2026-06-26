import packageJson from '../package.json' with { type: 'json' }
import config from './config.js'
import { disposableInterval, disposableTimeout } from './disposable.js'
import { ElectroluxClient } from './electrolux.js'
import createLogger from './logger.js'
import { runStartupMigrations } from './migrate.js'
import Mqtt from './mqtt.js'
import { Orchestrator } from './orchestrator.js'
import { deriveTelemetrySessionId, summarizeAppliances } from './telemetry.js'
import { startVersionChecker } from './version-checker.js'

const currentVersion = packageJson.version
const logger = createLogger('app')
logger.info({ version: currentVersion }, 'Starting Electrolux to MQTT')
const mqtt = new Mqtt()
const client = new ElectroluxClient(mqtt)

// Stable per-install Aptabase session id, derived from the Electrolux username. Constant
// across restarts so the badge can count distinct installs over a rolling window.
const telemetrySessionId = deriveTelemetrySessionId(config.electrolux.username)

const refreshInterval = client.refreshInterval * 1000
const applianceDiscoveryInterval = config.electrolux.applianceDiscoveryInterval * 1000

const orchestrator = new Orchestrator(client, mqtt, {
  refreshInterval,
  applianceDiscoveryInterval,
  autoDiscovery: config.homeAssistant.autoDiscovery,
  apiFailureRestartThresholdMs: config.healthCheck.unHealthyRestartMinutes * 60_000,
  healthCheckEnabled: config.healthCheck.enabled,
  applianceRemovalGracePeriodMs: config.electrolux.applianceRemovalGracePeriodMinutes * 60_000,
  haBirthRepublish: config.homeAssistant.birthRepublish,
  haBirthTopic: config.homeAssistant.statusTopic,
  haBirthPayload: config.homeAssistant.birthPayload,
})

let discoveryIntervalDisposable: Disposable | null = null
let stopVersionChecker: (() => void) | null = null
let restartTimeoutDisposable: Disposable | null = null

// Graceful shutdown handler
const shutdown = async () => {
  restartTimeoutDisposable?.[Symbol.dispose]()
  restartTimeoutDisposable = null
  discoveryIntervalDisposable?.[Symbol.dispose]()
  discoveryIntervalDisposable = null
  if (stopVersionChecker) stopVersionChecker()
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
      restartTimeoutDisposable = disposableTimeout(() => {
        restartTimeoutDisposable = null
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
      restartTimeoutDisposable = disposableTimeout(() => {
        restartTimeoutDisposable = null
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
  discoveryIntervalDisposable = disposableInterval(() => {
    if (orchestrator.isShuttingDown) {
      discoveryIntervalDisposable?.[Symbol.dispose]()
      discoveryIntervalDisposable = null
      return
    }
    orchestrator.discoverAppliances()
  }, applianceDiscoveryInterval)

  logger.info(`Appliance discovery running every ${applianceDiscoveryInterval / 1000 / 60} minutes to detect changes`)

  // Start version checker.
  // process.env.E2M_IMAGE_CHANNEL is baked into the Docker image at build time (UPDATE_CHANNEL ARG).
  // It is NOT routed through config.ts so it is honoured in YAML-config mode too.
  stopVersionChecker = startVersionChecker(
    currentVersion,
    {
      sessionId: telemetrySessionId,
      applianceSummary: () => summarizeAppliances(orchestrator.getApplianceInstances()),
    },
    mqtt,
    process.env.E2M_IMAGE_CHANNEL,
  )
}

if (process.env.VITEST !== 'true') {
  try {
    await main()
  } catch (err: unknown) {
    logger.error('Fatal error in main:', err)
  }
}

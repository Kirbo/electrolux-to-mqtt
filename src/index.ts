import packageJson from '../package.json' with { type: 'json' }
import { computeBackoffDelay } from './backoff.ts'
import { cache } from './cache.ts'
import config from './config.ts'
import { disposableInterval, disposableTimeout } from './disposable.ts'
import { ElectroluxApi } from './electrolux-api.ts'
import { ElectroluxAuth } from './electrolux-auth.ts'
import createLogger from './logger.ts'
import Mqtt from './mqtt.ts'
import { Orchestrator } from './orchestrator.ts'
import { StateSync } from './state-sync.ts'
import { deriveTelemetrySessionId, summarizeAppliances } from './telemetry.ts'
import { startVersionChecker } from './version-checker.ts'

const currentVersion = packageJson.version
const logger = createLogger('app')
logger.info(`Starting Electrolux to MQTT (version: ${currentVersion})`)
const mqtt = new Mqtt(config.mqtt, config.homeAssistant.discoveryPrefix)
const { electrolux } = config
const apiTimeoutMs = electrolux.apiTimeoutSeconds * 1000
const auth = new ElectroluxAuth({
  apiKey: electrolux.apiKey,
  username: electrolux.username,
  password: electrolux.password,
  countryCode: electrolux.countryCode,
  renewTokenBeforeExpiryMs: electrolux.renewTokenBeforeExpiry * 60_000,
  timeoutMs: apiTimeoutMs,
})
const api = new ElectroluxApi(auth, {
  apiKey: electrolux.apiKey,
  timeoutMs: apiTimeoutMs,
  refreshIntervalSeconds: electrolux.refreshInterval,
  discoveryIntervalSeconds: electrolux.applianceDiscoveryInterval,
})
const sync = new StateSync(api, mqtt, cache, {
  commandStateDelayMs: electrolux.commandStateDelaySeconds * 1000,
  showChanges: config.logging.showChanges,
  ignoredKeys: config.logging.ignoredKeys,
  revertStateOnRejection: config.homeAssistant.revertStateOnRejection,
})

// Stable per-install Aptabase session id (keyed hash of the Electrolux account). Constant
// across restarts so the badge can count distinct installs over a rolling window.
const telemetrySessionId = deriveTelemetrySessionId(electrolux.username, electrolux.apiKey)

const refreshInterval = electrolux.refreshInterval * 1000
const applianceDiscoveryInterval = electrolux.applianceDiscoveryInterval * 1000

const orchestrator = new Orchestrator(api, sync, mqtt, {
  refreshInterval,
  applianceDiscoveryInterval,
  autoDiscovery: config.homeAssistant.autoDiscovery,
  apiFailureRestartThresholdMs: config.healthCheck.unHealthyRestartMinutes * 60_000,
  healthCheckEnabled: config.healthCheck.enabled,
  applianceRemovalGracePeriodMs: config.electrolux.applianceRemovalGracePeriodMinutes * 60_000,
  haBirthRepublish: config.homeAssistant.birthRepublish,
  haBirthTopic: config.homeAssistant.statusTopic,
  haBirthPayload: config.homeAssistant.birthPayload,
  discoveryOrigin: {
    name: 'electrolux-to-mqtt',
    sw_version: currentVersion,
    support_url: 'https://gitlab.com/kirbodev/electrolux-to-mqtt',
  },
})

let discoveryIntervalDisposable: Disposable | null = null
let stopVersionChecker: (() => void) | null = null
let restartTimeoutDisposable: Disposable | null = null

// Docker's stop grace period is 10 s; give the MQTT flush half of it, then exit regardless.
const SHUTDOWN_TIMEOUT_MS = 5_000

// Graceful shutdown handler
const shutdown = async () => {
  restartTimeoutDisposable?.[Symbol.dispose]()
  restartTimeoutDisposable = null
  discoveryIntervalDisposable?.[Symbol.dispose]()
  discoveryIntervalDisposable = null
  if (stopVersionChecker) stopVersionChecker()
  auth.cleanup()
  let timeout: NodeJS.Timeout | undefined
  const timedOut = new Promise<void>((resolve) => {
    timeout = setTimeout(() => {
      logger.warn(`MQTT disconnect did not finish within ${SHUTDOWN_TIMEOUT_MS / 1000}s — exiting anyway`)
      resolve()
    }, SHUTDOWN_TIMEOUT_MS)
  })
  await Promise.race([orchestrator.shutdown(), timedOut])
  clearTimeout(timeout)
  process.exit(0)
}

const onSignal = () => {
  shutdown().catch((err: unknown) => {
    logger.error('Error during shutdown:', err)
    process.exit(1)
  })
}

process.on('SIGTERM', onSignal)
process.on('SIGINT', onSignal)

// Retries of main() (API failure / zero appliances) back off exponentially from
// refreshInterval up to this cap, instead of hammering the API at a fixed rate.
const MAIN_RETRY_MAX_DELAY_MS = 30 * 60_000

let mainRetryCount = 0

const scheduleMainRetry = (reason: string) => {
  if (orchestrator.isShuttingDown) return
  const delay = computeBackoffDelay(mainRetryCount, refreshInterval, MAIN_RETRY_MAX_DELAY_MS)
  mainRetryCount++
  logger.error(`${reason} Retrying in ${Math.round(delay / 1000)} seconds...`)
  restartTimeoutDisposable = disposableTimeout(() => {
    restartTimeoutDisposable = null
    main().catch((err: unknown) => logger.error('Error in restart:', err))
  }, delay)
}

export const main = async () => {
  logger.info(`Appliance refresh interval set to: ${refreshInterval / 1000} seconds`)

  // Log in first (retries with backoff until it succeeds), so the first API calls don't each wait on it
  await auth.getAccessToken()

  // Initial appliance discovery
  const appliances = await api.getAppliances()

  if (!appliances) {
    // API call failed (network error, DNS failure, etc.)
    scheduleMainRetry('Failed to fetch appliances due to API error.')
    return
  }

  if (appliances.length === 0) {
    scheduleMainRetry(
      'No appliances found. Please check your configuration and ensure you have appliances registered in Electrolux Mobile App.',
    )
    return
  }

  mainRetryCount = 0
  logger.info(`Found ${appliances.length} appliance(s), initializing...`)

  const totalAppliances = appliances.length
  const intervalDelay = refreshInterval / totalAppliances

  // Initialize all appliances concurrently; their polling start is staggered by delay
  await Promise.all(appliances.map((appliance, i) => orchestrator.initializeAppliance(appliance, i * intervalDelay)))

  // Start periodic appliance discovery
  discoveryIntervalDisposable = disposableInterval(() => {
    if (orchestrator.isShuttingDown) {
      discoveryIntervalDisposable?.[Symbol.dispose]()
      discoveryIntervalDisposable = null
      return
    }
    // discoverAppliances() catches and logs its own errors
    void orchestrator.discoverAppliances()
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

/** Run the bridge, logging (not throwing) a fatal error. The image's entry points call this. */
export const start = async (): Promise<void> => {
  try {
    await main()
  } catch (err: unknown) {
    logger.error('Fatal error in main:', err)
  }
}

// Run only as the entry module (`node src/index.ts`), never on import — the legacy
// `dist/index.js` shim (docker/compat/legacy-dist/) imports this module and calls start() itself.
if (import.meta.main) {
  await start()
}

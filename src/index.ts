import packageJson from '../package.json' with { type: 'json' }
import { cache } from './cache.js'
import config from './config.js'
import ElectroluxClient from './electrolux.js'
import createLogger from './logger.js'
import Mqtt from './mqtt.js'
import { SanitizedState } from './types.js'
import { initializeHelpers } from './utils.js'

const appVersion = packageJson.version
const logger = createLogger('app')
const mqtt = new Mqtt()
const client = new ElectroluxClient(mqtt)
const { exampleConfig, autoDiscovery } = initializeHelpers(mqtt)

const refreshInterval = (client.refreshInterval ?? 60) * 1000

// Track all intervals for cleanup
const activeIntervals = new Set<NodeJS.Timeout>()
let isShuttingDown = false

// Graceful shutdown handler
const shutdown = async () => {
  if (isShuttingDown) return
  isShuttingDown = true

  logger.info('Shutting down gracefully...')

  // Clear all intervals
  for (const interval of activeIntervals) {
    clearInterval(interval)
  }
  activeIntervals.clear()

  // Disconnect MQTT
  mqtt.disconnect()

  logger.info('Shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

// Wait for client login with retry logic
const waitForLogin = async () => {
  while (!client.isLoggedIn) {
    if (client.isLoggingIn) {
      logger.debug('Already logging in, waiting for login to complete...')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    } else {
      try {
        await client.login()
      } catch (error) {
        logger.error('Login failed:', error)
        await new Promise((resolve) => setTimeout(resolve, 10000))
      }
    }
  }
}

const main = async () => {
  logger.info(
    `Starting Electrolux to MQTT version: "${appVersion}", with refresh interval: ${refreshInterval / 1000} seconds`,
  )

  // Initialize the client
  await client.initialize()
  await waitForLogin()

  const appliances = await client.getAppliances()

  if (!appliances || appliances.length === 0) {
    logger.error(
      `No appliances found. Please check your configuration and ensure you have appliances registered in Electrolux Mobile App. Retrying in ${refreshInterval / 1000} seconds...`,
    )
    if (!isShuttingDown) {
      setTimeout(() => main(), refreshInterval)
    }
    return
  }

  const totalAppliances = appliances.length
  const intervalDelay = refreshInterval / totalAppliances

  for (let i = 0; i < appliances.length; i++) {
    const appliance = appliances[i]
    const { applianceId } = appliance

    const applianceInfo = await client.getApplianceInfo(applianceId)
    if (!applianceInfo) {
      logger.error('Failed to get appliance info for applianceId:', applianceId)
      continue
    }

    let applianceDiscoveryCallback: ((state: SanitizedState) => void) | undefined
    if (config.homeAssistant.autoDiscovery) {
      mqtt.autoDiscovery(applianceId, JSON.stringify(autoDiscovery(appliance, applianceInfo)), {
        retain: true,
        qos: 2,
      })

      applianceDiscoveryCallback = (state: SanitizedState) => {
        const cacheKey = cache.cacheKey(applianceId).autoDiscovery
        const autoDiscoveryConfig = autoDiscovery(appliance, applianceInfo, state)

        if (cache.matchByValue(cacheKey, autoDiscoveryConfig)) {
          return
        }

        mqtt.autoDiscovery(applianceId, JSON.stringify(autoDiscoveryConfig), {
          retain: true,
          qos: 2,
        })
      }
    } else {
      await client.getApplianceState(applianceId, (state) => {
        logger.info('Example config:', exampleConfig(appliance, applianceInfo, state))
      })
    }

    setTimeout(async () => {
      if (isShuttingDown) return

      await client.getApplianceState(applianceId, applianceDiscoveryCallback)

      const intervalId = setInterval(async () => {
        if (isShuttingDown) {
          clearInterval(intervalId)
          return
        }
        await client.getApplianceState(applianceId, applianceDiscoveryCallback)
      }, refreshInterval)

      activeIntervals.add(intervalId)
    }, i * intervalDelay)

    mqtt.subscribe(`${applianceId}/command`, (topic, message) => {
      const command = JSON.parse(message.toString())
      logger.info('Received command on topic:', topic, 'Message:', command)
      client.sendApplianceCommand(applianceId, command)
    })
  }
}

main()

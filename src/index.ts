import type { BaseAppliance } from './appliances/base.js'
import { ApplianceFactory } from './appliances/factory.js'
import { cache } from './cache.js'
import config from './config.js'
import { ElectroluxClient } from './electrolux.js'
import createLogger from './logger.js'
import Mqtt from './mqtt.js'
import type { ApplianceStub } from './types.js'

const logger = createLogger('app')
const mqtt = new Mqtt()
const client = new ElectroluxClient(mqtt)

const refreshInterval = (client.refreshInterval ?? 60) * 1000
const applianceDiscoveryInterval = (config.electrolux.applianceDiscoveryInterval ?? 300) * 1000

// Track all intervals and appliance instances for cleanup
const activeIntervals = new Set<NodeJS.Timeout>()
const applianceInstances = new Map<string, BaseAppliance>()
const applianceStateIntervals = new Map<string, NodeJS.Timeout>()
let discoveryInterval: NodeJS.Timeout | null = null
let isShuttingDown = false

// Graceful shutdown handler
const shutdown = async () => {
  if (isShuttingDown) return
  isShuttingDown = true

  logger.info('Shutting down gracefully...')

  // Clear discovery interval
  if (discoveryInterval) {
    clearInterval(discoveryInterval)
  }

  // Clear all intervals
  for (const interval of activeIntervals) {
    clearInterval(interval)
  }
  activeIntervals.clear()

  // Clear appliance state intervals
  for (const interval of applianceStateIntervals.values()) {
    clearInterval(interval)
  }
  applianceStateIntervals.clear()

  // Cleanup client timeouts
  client.cleanup()

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

/**
 * Initialize a single appliance with state polling and MQTT subscription
 */
const initializeAppliance = async (
  applianceStub: { applianceId: string; applianceName: string; applianceType: string; created: string },
  delayMs: number = 0,
) => {
  const { applianceId } = applianceStub

  try {
    const applianceInfo = await client.getApplianceInfo(applianceId)
    if (!applianceInfo) {
      logger.error('Failed to get appliance info for applianceId:', applianceId)
      return
    }

    // Create appliance instance using the factory
    const appliance = ApplianceFactory.create(applianceStub, applianceInfo)
    applianceInstances.set(applianceId, appliance)

    logger.info(
      `Initialized appliance: ${appliance.getApplianceName()} (${appliance.getModelName()}) with ID: ${applianceId}`,
    )

    let applianceDiscoveryCallback: (() => void) | undefined
    if (config.homeAssistant.autoDiscovery) {
      // Generate and publish auto-discovery config using the appliance-specific logic
      logger.debug(`Using topicPrefix for auto-discovery: "${mqtt.topicPrefix}"`)
      const discoveryConfig = appliance.generateAutoDiscoveryConfig(mqtt.topicPrefix)
      logger.debug('Generated auto-discovery config:', discoveryConfig)
      mqtt.autoDiscovery(applianceId, JSON.stringify(discoveryConfig), {
        retain: true,
        qos: 2,
      })

      applianceDiscoveryCallback = () => {
        const cacheKey = cache.cacheKey(applianceId).autoDiscovery
        const autoDiscoveryConfig = appliance.generateAutoDiscoveryConfig(mqtt.topicPrefix)

        if (cache.matchByValue(cacheKey, autoDiscoveryConfig)) {
          return
        }

        mqtt.autoDiscovery(applianceId, JSON.stringify(autoDiscoveryConfig), {
          retain: true,
          qos: 2,
        })
      }
    } else {
      await client.getApplianceState(appliance, () => {
        logger.info('Appliance initialized successfully')
      })
    }

    // Start state polling after optional delay
    setTimeout(async () => {
      if (isShuttingDown) return

      await client.getApplianceState(appliance, applianceDiscoveryCallback)

      const intervalId = setInterval(async () => {
        if (isShuttingDown) {
          clearInterval(intervalId)
          return
        }
        await client.getApplianceState(appliance, applianceDiscoveryCallback)
      }, refreshInterval)

      activeIntervals.add(intervalId)
      applianceStateIntervals.set(applianceId, intervalId)
    }, delayMs)

    // Subscribe to MQTT commands for this appliance
    mqtt.subscribe(`${applianceId}/command`, (topic, message) => {
      try {
        const command = JSON.parse(message.toString())
        logger.info('Received command on topic:', topic, 'Message:', command)
        const applianceInstance = applianceInstances.get(applianceId)
        if (applianceInstance) {
          client.sendApplianceCommand(applianceInstance, command)
        } else {
          logger.error(`No appliance instance found for applianceId: ${applianceId}`)
        }
      } catch (error) {
        logger.error(`Failed to parse MQTT command from topic ${topic}:`, error)
      }
    })
  } catch (error) {
    logger.error(`Error initializing appliance ${applianceId}:`, error)
  }
}

/**
 * Clean up a removed appliance
 */
const cleanupAppliance = (applianceId: string) => {
  logger.info(`Cleaning up removed appliance: ${applianceId}`)

  // Clear state polling interval
  const stateInterval = applianceStateIntervals.get(applianceId)
  if (stateInterval) {
    clearInterval(stateInterval)
    activeIntervals.delete(stateInterval)
    applianceStateIntervals.delete(applianceId)
  }

  // Unsubscribe from MQTT commands
  mqtt.unsubscribe(`${applianceId}/command`)

  // Remove from instances map
  applianceInstances.delete(applianceId)

  // Optionally publish offline status
  if (config.homeAssistant.autoDiscovery) {
    mqtt.publish(
      `${applianceId}/state`,
      JSON.stringify({ applianceId, connectionState: 'disconnected', applianceState: 'off' }),
    )
  }

  logger.info(`Appliance ${applianceId} cleanup complete`)
}

/**
 * Discover and manage appliances dynamically
 */
const discoverAppliances = async () => {
  try {
    const appliances = await client.getAppliances()

    if (!appliances) {
      // API call failed (network error, DNS failure, etc.) - skip discovery
      // Don't treat this as "no appliances" to avoid cleaning up existing ones
      logger.debug('Skipping appliance discovery due to API error')
      return
    }

    if (appliances.length === 0) {
      logger.warn('No appliances found during discovery check')
      return
    }

    const currentApplianceIds = new Set(appliances.map((a: ApplianceStub) => a.applianceId))
    const knownApplianceIds = new Set(applianceInstances.keys())

    // Find new appliances
    const newAppliances = appliances.filter((a: ApplianceStub) => !knownApplianceIds.has(a.applianceId))

    // Find removed appliances
    const removedApplianceIds = Array.from(knownApplianceIds).filter((id) => !currentApplianceIds.has(id))

    // Initialize new appliances
    if (newAppliances.length > 0) {
      logger.info(`Found ${newAppliances.length} new appliance(s)`)
      const intervalDelay = refreshInterval / (appliances.length + 1) // Distribute load

      for (let i = 0; i < newAppliances.length; i++) {
        const delay = i * intervalDelay
        await initializeAppliance(newAppliances[i], delay)
      }
    }

    // Clean up removed appliances
    if (removedApplianceIds.length > 0) {
      logger.info(`Detected ${removedApplianceIds.length} removed appliance(s)`)
      for (const applianceId of removedApplianceIds) {
        cleanupAppliance(applianceId)
      }
    }

    if (newAppliances.length === 0 && removedApplianceIds.length === 0) {
      logger.debug('No appliance changes detected')
    }
  } catch (error) {
    logger.error('Error during appliance discovery:', error)
  }
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
    if (!isShuttingDown) {
      setTimeout(() => main(), refreshInterval)
    }
    return
  }

  if (appliances.length === 0) {
    logger.error(
      `No appliances found. Please check your configuration and ensure you have appliances registered in Electrolux Mobile App. Retrying in ${refreshInterval / 1000} seconds...`,
    )
    if (!isShuttingDown) {
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
    await initializeAppliance(appliances[i], delay)
  }

  // Start periodic appliance discovery
  discoveryInterval = setInterval(() => {
    if (isShuttingDown) {
      if (discoveryInterval) clearInterval(discoveryInterval)
      return
    }
    discoverAppliances()
  }, applianceDiscoveryInterval)

  logger.info(`Appliance discovery running every ${applianceDiscoveryInterval / 1000 / 60} minutes to detect changes`)
}

main()

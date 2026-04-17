import type { BaseAppliance } from './appliances/base.js'
import { createAppliance } from './appliances/factory.js'
import { cache } from './cache.js'
import type { ElectroluxClient } from './electrolux.js'
import { writeHealthFile } from './health.js'
import createLogger from './logger.js'
import type { IMqtt } from './mqtt.js'
import type { ApplianceStub } from './types.js'

const logger = createLogger('app')

export interface OrchestratorConfig {
  refreshInterval: number
  applianceDiscoveryInterval: number
  autoDiscovery: boolean
  apiFailureRestartThresholdMs: number
  healthCheckEnabled: boolean
}

export class Orchestrator {
  private readonly client: ElectroluxClient
  private readonly mqtt: IMqtt
  private readonly config: OrchestratorConfig
  private readonly activeIntervals = new Set<NodeJS.Timeout>()
  private readonly activeTimeouts = new Set<NodeJS.Timeout>()
  private readonly applianceInstances = new Map<string, BaseAppliance>()
  private readonly applianceStateIntervals = new Map<string, NodeJS.Timeout>()
  private lastSuccessfulApiCall = Date.now()
  private _reconnectRegistered = false
  public isShuttingDown = false

  constructor(client: ElectroluxClient, mqtt: IMqtt, config: OrchestratorConfig) {
    this.client = client
    this.mqtt = mqtt
    this.config = config
  }

  public getApplianceInstances(): ReadonlyMap<string, BaseAppliance> {
    return this.applianceInstances
  }

  private trackApiResult(state: unknown, now: number): void {
    if (state !== undefined) {
      this.lastSuccessfulApiCall = now
    } else if (this.config.healthCheckEnabled && !this.isShuttingDown) {
      const elapsedMs = now - this.lastSuccessfulApiCall
      if (elapsedMs >= this.config.apiFailureRestartThresholdMs) {
        logger.warn(`API unreachable for ${Math.round(elapsedMs / 60000)} min — restarting for recovery`)
        process.exit(1)
      }
    }
  }

  private writeHealthStatus(): void {
    const now = Date.now()
    const apiConnected = now - this.lastSuccessfulApiCall < 3 * this.config.refreshInterval
    writeHealthFile({ mqttConnected: this.mqtt.client.connected, apiConnected })
  }

  /**
   * Register a single reconnect callback on the MQTT layer that republishes
   * cached state for all active appliances. Guarded so it runs at most once
   * per Orchestrator instance regardless of how many appliances are initialized.
   *
   * Fires on every 'connect' event (initial connect + reconnects). Republishing
   * on initial connect is idempotent and ensures state is always current after
   * any broker connection, including the first one.
   */
  private _registerReconnectHandler(): void {
    if (this._reconnectRegistered) return
    this._reconnectRegistered = true

    this.mqtt.onReconnect(() => {
      logger.info('MQTT connected — republishing cached state for all appliances')
      for (const [applianceId] of this.applianceInstances) {
        const stateKey = cache.cacheKey(applianceId).state
        const state = cache.get(stateKey)
        if (state === undefined || state === null) {
          logger.debug(`No cached state for appliance ${applianceId} — skipping reconnect republish`)
          continue
        }
        this.mqtt.publish(`${applianceId}/state`, JSON.stringify(state))
      }
    })
  }

  /**
   * Start the state polling loop for a single appliance: fires once after
   * delayMs then repeats every refreshInterval. Uses .then().catch() chains
   * so a rejection in getApplianceState (or any downstream call) is caught
   * and logged rather than escaping as an unhandled rejection.
   */
  private _startPolling(
    applianceId: string,
    appliance: BaseAppliance,
    applianceDiscoveryCallback: (() => void) | undefined,
    delayMs: number,
  ): void {
    const timeoutId = setTimeout(() => {
      this.activeTimeouts.delete(timeoutId)
      if (this.isShuttingDown) return
      if (!this.applianceInstances.has(applianceId)) return

      this.client
        .getApplianceState(appliance, applianceDiscoveryCallback)
        .then((state) => {
          this.trackApiResult(state, Date.now())
          this.writeHealthStatus()
        })
        .catch((err: unknown) => {
          logger.error(`Error on initial state poll for appliance ${applianceId}:`, err)
        })
        .finally(() => {
          if (this.isShuttingDown) return
          if (!this.applianceInstances.has(applianceId)) return

          const intervalId = setInterval(() => {
            if (this.isShuttingDown) {
              clearInterval(intervalId)
              return
            }
            this.client
              .getApplianceState(appliance, applianceDiscoveryCallback)
              .then((intervalState) => {
                this.trackApiResult(intervalState, Date.now())
                this.writeHealthStatus()
              })
              .catch((err: unknown) => {
                logger.error(`Error polling state for appliance ${applianceId}:`, err)
              })
          }, this.config.refreshInterval)

          this.activeIntervals.add(intervalId)
          this.applianceStateIntervals.set(applianceId, intervalId)
        })
    }, delayMs)
    this.activeTimeouts.add(timeoutId)
  }

  /**
   * Initialize a single appliance with state polling and MQTT subscription
   */
  public async initializeAppliance(applianceStub: ApplianceStub, delayMs = 0) {
    const { applianceId } = applianceStub

    try {
      const applianceInfo = await this.client.getApplianceInfo(applianceId)
      if (!applianceInfo) {
        logger.error('Failed to get appliance info for applianceId:', applianceId)
        return
      }

      // Create appliance instance using the factory
      const appliance = createAppliance(applianceStub, applianceInfo)
      this.applianceInstances.set(applianceId, appliance)

      logger.info(
        `Initialized appliance: ${appliance.getApplianceName()} (${appliance.getModelName()}) with ID: ${applianceId}`,
      )

      let applianceDiscoveryCallback: (() => void) | undefined
      if (this.config.autoDiscovery) {
        // Generate and publish auto-discovery config using the appliance-specific logic
        logger.debug(`Using topicPrefix for auto-discovery: "${this.mqtt.topicPrefix}"`)
        const discoveryConfig = appliance.generateAutoDiscoveryConfig(this.mqtt.topicPrefix)
        logger.debug('Generated auto-discovery config:', discoveryConfig)
        this.mqtt.autoDiscovery(applianceId, JSON.stringify(discoveryConfig), {
          retain: true,
          qos: 2,
        })

        applianceDiscoveryCallback = () => {
          const capabilitiesHash = appliance.getCapabilitiesHash()
          const cacheKey = cache.cacheKey(applianceId, capabilitiesHash).autoDiscovery
          const autoDiscoveryConfig = appliance.generateAutoDiscoveryConfig(this.mqtt.topicPrefix)

          if (cache.matchByValue(cacheKey, autoDiscoveryConfig)) {
            return
          }

          this.mqtt.autoDiscovery(applianceId, JSON.stringify(autoDiscoveryConfig), {
            retain: true,
            qos: 2,
          })
        }
      }

      // Register the MQTT reconnect handler (once per orchestrator instance)
      this._registerReconnectHandler()

      // Start state polling after optional delay
      this._startPolling(applianceId, appliance, applianceDiscoveryCallback, delayMs)

      // Subscribe to MQTT commands for this appliance
      await this.mqtt.subscribe(`${applianceId}/command`, (topic, message) => {
        try {
          const command = JSON.parse(message.toString())
          logger.info('Received command on topic:', topic, 'Message:', command)
          const applianceInstance = this.applianceInstances.get(applianceId)
          if (applianceInstance) {
            this.client.sendApplianceCommand(applianceInstance, command).catch((err: unknown) => {
              logger.error(`Failed to send command to appliance ${applianceId}:`, err)
            })
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
  public cleanupAppliance(applianceId: string) {
    logger.info(`Cleaning up removed appliance: ${applianceId}`)

    // Clear state polling interval
    const stateInterval = this.applianceStateIntervals.get(applianceId)
    if (stateInterval) {
      clearInterval(stateInterval)
      this.activeIntervals.delete(stateInterval)
      this.applianceStateIntervals.delete(applianceId)
    }

    // Unsubscribe from MQTT commands
    this.mqtt.unsubscribe(`${applianceId}/command`)

    // Remove from instances map and clean up client tracking data
    this.applianceInstances.delete(applianceId)
    this.client.removeAppliance(applianceId)

    // Optionally publish offline status
    if (this.config.autoDiscovery) {
      this.mqtt.publish(
        `${applianceId}/state`,
        JSON.stringify({ applianceId, connectionState: 'disconnected', applianceState: 'off' }),
      )
    }

    logger.info(`Appliance ${applianceId} cleanup complete`)
  }

  /**
   * Discover and manage appliances dynamically
   */
  public async discoverAppliances() {
    try {
      const appliances = await this.client.getAppliances()

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
      const knownApplianceIds = new Set(this.applianceInstances.keys())

      // Find new appliances
      const newAppliances = appliances.filter((a: ApplianceStub) => !knownApplianceIds.has(a.applianceId))

      // Find removed appliances
      const removedApplianceIds = Array.from(knownApplianceIds).filter((id) => !currentApplianceIds.has(id))

      // Initialize new appliances
      if (newAppliances.length > 0) {
        logger.info(`Found ${newAppliances.length} new appliance(s)`)
        const intervalDelay = this.config.refreshInterval / (appliances.length + 1) // Distribute load

        for (const [i, appliance] of newAppliances.entries()) {
          const delay = i * intervalDelay
          await this.initializeAppliance(appliance, delay)
        }
      }

      // Clean up removed appliances
      if (removedApplianceIds.length > 0) {
        logger.info(`Detected ${removedApplianceIds.length} removed appliance(s)`)
        for (const applianceId of removedApplianceIds) {
          this.cleanupAppliance(applianceId)
        }
      }

      if (newAppliances.length === 0 && removedApplianceIds.length === 0) {
        logger.debug('No appliance changes detected')
      }
    } catch (error) {
      logger.error('Error during appliance discovery:', error)
    }
  }

  /**
   * Graceful shutdown: stop all intervals, clean up client, disconnect MQTT
   */
  public shutdown(stopVersionChecker: (() => void) | null, discoveryInterval: NodeJS.Timeout | null) {
    if (this.isShuttingDown) return
    this.isShuttingDown = true

    logger.info('Shutting down gracefully...')

    // Stop version checker
    if (stopVersionChecker) {
      stopVersionChecker()
    }

    // Clear discovery interval
    if (discoveryInterval) {
      clearInterval(discoveryInterval)
    }

    // Clear pending startup timeouts
    for (const t of this.activeTimeouts) {
      clearTimeout(t)
    }
    this.activeTimeouts.clear()

    // Clear all intervals
    for (const interval of this.activeIntervals) {
      clearInterval(interval)
    }
    this.activeIntervals.clear()

    // Clear appliance state intervals
    for (const interval of this.applianceStateIntervals.values()) {
      clearInterval(interval)
    }
    this.applianceStateIntervals.clear()

    // Cleanup client timeouts
    this.client.cleanup()

    // Disconnect MQTT
    this.mqtt.disconnect()

    logger.info('Shutdown complete')
  }
}

import type { BaseAppliance } from './appliances/base.js'
import { createAppliance } from './appliances/factory.js'
import { cache } from './cache.js'
import type { ElectroluxClient } from './electrolux.js'
import { getStateDifferences, isAppliance } from './electrolux.js'
import { writeHealthFile } from './health.js'
import type { LivestreamClient } from './livestream.js'
import { applyStreamEvent } from './livestream-events.js'
import createLogger from './logger.js'
import type { IMqtt } from './mqtt.js'
import type { Appliance, ApplianceStub, StreamEvent } from './types.js'

const logger = createLogger('app')

// A stream is considered stale when no liveness signal (delta, reseed, discovery) has been
// received for more than 2× the idle timeout. During this window the idle watchdog would
// already have reconnected, so a signal should have arrived. Beyond this we treat the stream
// as truly dead and let the restart threshold handle recovery.
const STREAM_STALE_FACTOR = 2

export interface OrchestratorConfig {
  refreshInterval: number
  commandStateDelaySeconds: number
  applianceDiscoveryInterval: number
  autoDiscovery: boolean
  apiFailureRestartThresholdMs: number
  healthCheckEnabled: boolean
  applianceRemovalGracePeriodMs: number
  haBirthRepublish: boolean
  haBirthTopic: string
  haBirthPayload: string
  idleTimeoutMs: number
}

export class Orchestrator implements AsyncDisposable {
  private readonly client: ElectroluxClient
  private readonly mqtt: IMqtt
  private readonly config: OrchestratorConfig
  private livestream: LivestreamClient | null = null
  private readonly activeTimeouts = new Set<NodeJS.Timeout>()
  private readonly activeCommandTimeouts = new Set<NodeJS.Timeout>()
  private readonly applianceInstances = new Map<string, BaseAppliance>()
  private readonly applianceStateIntervals = new Map<string, NodeJS.Timeout>()
  private readonly applianceMissingSince = new Map<string, number>()
  private lastStreamSignal = Date.now()
  private lastSuccessfulPollAt = 0 // 0 = no poll yet
  private _reconnectRegistered = false
  private _birthRegistered = false
  private _livestreamInitialized = false
  public isShuttingDown = false

  constructor(client: ElectroluxClient, mqtt: IMqtt, config: OrchestratorConfig) {
    this.client = client
    this.mqtt = mqtt
    this.config = config
  }

  public getApplianceInstances(): ReadonlyMap<string, BaseAppliance> {
    return this.applianceInstances
  }

  // ---------------------------------------------------------------------------
  // Health tracking
  // ---------------------------------------------------------------------------

  /** Advance the last-signal timestamp. Called on delta, reseed, and discovery. */
  private bumpStreamSignal(): void {
    this.lastStreamSignal = Date.now()
  }

  /** Record a successful poll result (state obtained from API). Used for health checks. */
  private bumpPollSignal(): void {
    this.lastSuccessfulPollAt = Date.now()
  }

  private isApiConnected(): boolean {
    const now = Date.now()
    // A recent poll is a direct proof of API liveness.
    const pollFresh = this.lastSuccessfulPollAt > 0 && now - this.lastSuccessfulPollAt < 3 * this.config.refreshInterval
    // SSE liveness: stream connected + a recent signal (delta/reseed/discovery)
    const streamStaleMs = STREAM_STALE_FACTOR * this.config.idleTimeoutMs
    const streamFresh = (this.livestream?.isStreamConnected() ?? false) && now - this.lastStreamSignal < streamStaleMs
    return pollFresh || streamFresh
  }

  private trackApiResult(state: unknown, now: number): void {
    if (state !== undefined) {
      this.bumpStreamSignal()
    } else if (this.config.healthCheckEnabled && !this.isShuttingDown) {
      const elapsedMs = now - this.lastStreamSignal
      if (elapsedMs >= this.config.apiFailureRestartThresholdMs) {
        logger.warn(`API unreachable for ${Math.round(elapsedMs / 60000)} min — restarting for recovery`)
        process.exit(1)
      }
    }
  }

  private writeHealthStatus(): void {
    const apiConnected = this.isApiConnected()
    writeHealthFile({ mqttConnected: this.mqtt.client.connected, apiConnected })
  }

  // ---------------------------------------------------------------------------
  // Periodic state polling (baseline source of truth)
  // ---------------------------------------------------------------------------

  /**
   * Start the state polling loop for a single appliance.
   * Fires once after delayMs (load-distributed stagger), then repeats every refreshInterval.
   * SSE deltas provide between-poll immediacy; polls are the authoritative source of truth.
   */
  private _startPolling(applianceId: string, appliance: BaseAppliance, delayMs: number): void {
    const settleWindowMs = this.config.commandStateDelaySeconds * 1000
    const timeoutId = setTimeout(() => {
      this.activeTimeouts.delete(timeoutId)
      if (this.isShuttingDown) return
      if (!this.applianceInstances.has(applianceId)) return

      this.client
        .reseedApplianceState(appliance, settleWindowMs)
        .then((state) => {
          if (state !== undefined) this.bumpPollSignal()
          this.trackApiResult(state, Date.now())
          this.writeHealthStatus()
        })
        .catch((err: unknown) => {
          logger.error(`Error on initial state poll for appliance ${applianceId}:`, err)
        })
        .finally(() => {
          this._startIntervalPolling(applianceId, appliance, settleWindowMs)
        })
    }, delayMs)
    this.activeTimeouts.add(timeoutId)
  }

  private _startIntervalPolling(applianceId: string, appliance: BaseAppliance, settleWindowMs: number): void {
    if (this.isShuttingDown) return
    if (!this.applianceInstances.has(applianceId)) return

    const intervalId = setInterval(() => {
      if (this.isShuttingDown) {
        clearInterval(intervalId)
        return
      }
      this.client
        .reseedApplianceState(appliance, settleWindowMs)
        .then((state) => {
          if (state !== undefined) this.bumpPollSignal()
          this.trackApiResult(state, Date.now())
          this.writeHealthStatus()
        })
        .catch((err: unknown) => {
          logger.error(`Error polling state for appliance ${applianceId}:`, err)
        })
    }, this.config.refreshInterval)

    this.applianceStateIntervals.set(applianceId, intervalId)
  }

  /**
   * Schedule an authoritative re-poll after commandStateDelaySeconds.
   * Called after a successful command send to reconcile the optimistic state
   * against the API once the Electrolux backend has registered the change.
   */
  public scheduleCommandRepoll(appliance: BaseAppliance): void {
    if (this.isShuttingDown) return
    const applianceId = appliance.getApplianceId()
    const delayMs = this.config.commandStateDelaySeconds * 1000

    const timeoutId = setTimeout(() => {
      this.activeCommandTimeouts.delete(timeoutId)
      if (this.isShuttingDown) return
      if (!this.applianceInstances.has(applianceId)) return
      // Re-poll with settleWindowMs=0: this IS the authoritative resync; no window needed.
      this.client
        .reseedApplianceState(appliance, 0)
        .then((state) => {
          if (state !== undefined) this.bumpPollSignal()
          this.trackApiResult(state, Date.now())
          this.writeHealthStatus()
        })
        .catch((err: unknown) => {
          logger.error(`Error on command re-poll for appliance ${applianceId}:`, err)
        })
    }, delayMs)
    this.activeCommandTimeouts.add(timeoutId)
  }

  // ---------------------------------------------------------------------------
  // MQTT reconnect + HA birth handlers
  // ---------------------------------------------------------------------------

  /**
   * Resolve the state to publish for an appliance from the cache entry.
   *
   * The cache is dual-shape:
   * - Raw `Appliance` (after reseed / stream-delta): must be normalized before
   *   publishing so HA templates see top-level fields like `mode`.
   * - Already-normalized object (after command optimistic feedback): publish as-is.
   *
   * Returns `null` when there is nothing cached (caller should skip the publish).
   */
  private _resolveStateForRepublish(applianceId: string, appliance: BaseAppliance): string | null {
    const stateKey = cache.cacheKey(applianceId).state
    const cached = cache.get(stateKey)
    if (cached === undefined || cached === null) {
      logger.debug(`No cached state for appliance ${applianceId} — skipping state republish`)
      return null
    }
    if (isAppliance(cached)) {
      return JSON.stringify(appliance.normalizeState(cached))
    }
    return JSON.stringify(cached)
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
      for (const [applianceId, appliance] of this.applianceInstances) {
        const payload = this._resolveStateForRepublish(applianceId, appliance)
        if (payload === null) continue
        this.mqtt.publish(`${applianceId}/state`, payload)
      }
    })
  }

  /**
   * Unconditionally republish discovery config and cached state for every active
   * appliance. Used by the MQTT reconnect handler and the HA birth-message handler.
   *
   * Discovery is only emitted when autoDiscovery is enabled.
   * State is only emitted when there is a non-null cached value.
   */
  private republishAll(): void {
    for (const [applianceId, appliance] of this.applianceInstances) {
      if (this.config.autoDiscovery) {
        const discoveryConfig = appliance.generateAutoDiscoveryConfig(this.mqtt.topicPrefix)
        this.mqtt.autoDiscovery(applianceId, JSON.stringify(discoveryConfig), { retain: true, qos: 2 })
      }

      const payload = this._resolveStateForRepublish(applianceId, appliance)
      if (payload === null) continue
      this.mqtt.publish(`${applianceId}/state`, payload)
    }
  }

  /**
   * Subscribe to the HA status topic once to listen for birth messages.
   * When HA comes online (payload matches birthPayload), republish discovery
   * config + cached state for all active appliances so HA recovers entity
   * state without needing MQTT retain.
   *
   * Guarded by _birthRegistered so it runs at most once per Orchestrator.
   */
  private _registerBirthHandler(): void {
    if (this._birthRegistered) return
    if (!this.config.haBirthRepublish) return
    this._birthRegistered = true

    this.mqtt
      .subscribeAbsolute(this.config.haBirthTopic, (_topic, message) => {
        const payload = message.toString()
        if (payload !== this.config.haBirthPayload) {
          logger.debug(`HA status message received with payload "${payload}" — ignoring (not a birth message)`)
          return
        }
        logger.info('Home Assistant came online — republishing discovery config and cached state for all appliances')
        this.republishAll()
      })
      .catch((err: unknown) => {
        logger.error('Failed to subscribe to HA status topic:', err)
      })
  }

  // ---------------------------------------------------------------------------
  // Stream event handling
  // ---------------------------------------------------------------------------

  /**
   * Handle a single SSE delta from the livestream.
   *
   * Happy path: patch the cached raw Appliance, normalize before/after,
   * diff, and publish only if something changed.
   *
   * Self-healing path: if the cache holds normalized state (e.g. an optimistic
   * publish after a command), the delta can't be cleanly applied — drop it and
   * trigger a reseed to restore a raw-Appliance cache entry.
   */
  public handleStreamEvent(event: StreamEvent): void {
    const appliance = this.applianceInstances.get(event.applianceId)
    if (!appliance) {
      logger.debug(
        { applianceId: event.applianceId, property: event.property },
        'SSE event for untracked applianceId — ignored',
      )
      return
    }

    const applianceId = event.applianceId
    const stateKey = cache.cacheKey(applianceId).state
    const cached = cache.get(stateKey)

    const settleWindowMs = this.config.commandStateDelaySeconds * 1000

    if (!isAppliance(cached)) {
      // Cache holds normalized state or is empty — cannot safely apply delta.
      // Trigger a reseed to restore raw Appliance in cache, then return.
      // Pass settleWindowMs so the guard in fetchAndProcessApplianceState suppresses
      // any regressive publish of stale commanded fields during the settle window.
      logger.debug(`Stream delta for ${applianceId}: cache is not a raw Appliance — triggering reseed (self-heal)`)
      this.client
        .reseedApplianceState(appliance, settleWindowMs)
        .then((state: Appliance | undefined) => {
          this.trackApiResult(state, Date.now())
          this.writeHealthStatus()
        })
        .catch((err: unknown) => {
          logger.error(`Reseed after cache-mismatch failed for ${applianceId}:`, err)
        })
      return
    }

    const patched = applyStreamEvent(cached, event)
    const cachedNormalized = appliance.normalizeState(cached)
    const newNormalized = appliance.normalizeState(patched)

    // Settle-window overlay: during the command settle window, prevent commanded fields
    // from regressing to their stale API values via the SSE delta path. Non-commanded
    // fields (e.g. ambientTemperatureC, compressorState) continue to update live.
    const pins = this.client.getPendingCommandFields(applianceId, settleWindowMs)
    const stateToPublish: typeof newNormalized = pins ? { ...newNormalized, ...pins } : newNormalized

    const diffs = getStateDifferences(cachedNormalized, stateToPublish)

    if (Object.keys(diffs).length > 0) {
      cache.set(stateKey, patched)
      this.mqtt.publish(`${applianceId}/state`, JSON.stringify(stateToPublish))
      logger.debug(`Stream delta applied for ${applianceId}: ${Object.keys(diffs).join(', ')}`)
    } else {
      logger.debug({ applianceId, property: event.property }, 'SSE event applied with no state change')
    }

    this.bumpStreamSignal()
    this.writeHealthStatus()
  }

  // ---------------------------------------------------------------------------
  // Appliance lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize a single appliance: fetch info, create instance, publish discovery,
   * register handlers, start polling loop, and subscribe to MQTT commands.
   *
   * delayMs: staggered initial poll delay so appliances don't all hit the API at once.
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

      if (this.config.autoDiscovery) {
        // Generate and publish auto-discovery config using the appliance-specific logic
        logger.debug(`Using topicPrefix for auto-discovery: "${this.mqtt.topicPrefix}"`)
        const discoveryConfig = appliance.generateAutoDiscoveryConfig(this.mqtt.topicPrefix)
        logger.debug('Generated auto-discovery config:', discoveryConfig)
        this.mqtt.autoDiscovery(applianceId, JSON.stringify(discoveryConfig), {
          retain: true,
          qos: 2,
        })
      }

      // Register the MQTT reconnect handler (once per orchestrator instance)
      this._registerReconnectHandler()

      // Register the HA birth-message handler (once per orchestrator instance)
      this._registerBirthHandler()

      // Start state polling: fires initially after delayMs, then every refreshInterval.
      // This is the baseline source of truth; SSE deltas provide between-poll immediacy.
      this._startPolling(applianceId, appliance, delayMs)

      // Subscribe to MQTT commands for this appliance
      await this.mqtt.subscribe(`${applianceId}/command`, (topic, message) => {
        try {
          const command = JSON.parse(message.toString())
          logger.info('Received command on topic:', topic, 'Message:', command)
          const applianceInstance = this.applianceInstances.get(applianceId)
          if (applianceInstance) {
            this.client
              .sendApplianceCommand(applianceInstance, command)
              .then((result) => {
                // After a successful command, schedule an authoritative re-poll so the
                // API state (which lags ~15-17 s after a 200-OK) can catch up and confirm
                // (or correct) the optimistic publish. No-op if the command was rejected.
                if (result !== undefined) {
                  this.scheduleCommandRepoll(applianceInstance)
                }
              })
              .catch((err: unknown) => {
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

    // Clear state polling interval for this appliance
    const stateInterval = this.applianceStateIntervals.get(applianceId)
    if (stateInterval) {
      clearInterval(stateInterval)
      this.applianceStateIntervals.delete(applianceId)
    }

    // Clear missing-since tracking (idempotent — no-op if entry was never set)
    this.applianceMissingSince.delete(applianceId)

    // Purge cache entries before removing the instance (capabilitiesHash still reachable here)
    const appliance = this.applianceInstances.get(applianceId)
    const { state: stateKey, autoDiscovery: autoDiscoveryKey } = cache.cacheKey(
      applianceId,
      appliance?.getCapabilitiesHash(),
    )
    cache.delete(stateKey)
    cache.delete(autoDiscoveryKey)

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

  // ---------------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------------

  /**
   * Update the missing-since map after an authoritative API response.
   */
  private updateMissingSince(currentIds: ReadonlySet<string>, knownIds: ReadonlySet<string>, now: number): void {
    for (const id of knownIds) {
      if (currentIds.has(id)) {
        this.applianceMissingSince.delete(id)
      } else if (!this.applianceMissingSince.has(id)) {
        this.applianceMissingSince.set(id, now)
      }
    }
  }

  /**
   * Remove appliances that have been continuously absent beyond the grace period.
   */
  private sweepExpired(now: number): void {
    for (const [id, missingSince] of this.applianceMissingSince) {
      if (now - missingSince >= this.config.applianceRemovalGracePeriodMs) {
        logger.info(`Appliance ${id} absent for ≥ grace period — removing`)
        this.cleanupAppliance(id)
      }
    }
  }

  /**
   * Discover and manage appliances dynamically.
   *
   * Only a successful 200 response (array, including []) advances the
   * missing-since timer. API failures (undefined return) are "no signal"
   * and must not touch the timer — they return early without mutation.
   *
   * When the active set changes (new or swept appliances), refreshes the
   * livestream subscription so the SSE connection re-fetches config for
   * the updated appliance set.
   *
   * A successful discovery also advances the stream-liveness signal, since
   * it proves the API is reachable even during quiet periods.
   */
  public async discoverAppliances() {
    try {
      const appliances = await this.client.getAppliances()

      if (!appliances) {
        logger.debug('Skipping appliance discovery due to API error')
        return
      }

      if (appliances.length === 0) {
        logger.warn('No appliances found during discovery check')
      }

      const currentApplianceIds = new Set<string>(appliances.map((a: ApplianceStub) => a.applianceId))
      const knownApplianceIds = new Set<string>(this.applianceInstances.keys())
      const now = Date.now()

      this.updateMissingSince(currentApplianceIds, knownApplianceIds, now)
      this.sweepExpired(now)

      const newAppliances = appliances.filter((a: ApplianceStub) => !knownApplianceIds.has(a.applianceId))
      const setChanged = newAppliances.length > 0 || this.applianceMissingSince.size > 0

      if (newAppliances.length > 0) {
        logger.info(`Found ${newAppliances.length} new appliance(s)`)
        const intervalDelay = this.config.refreshInterval / (appliances.length + 1) // Distribute load
        for (const [i, appliance] of newAppliances.entries()) {
          await this.initializeAppliance(appliance, i * intervalDelay)
        }
      }

      if (newAppliances.length === 0 && this.applianceMissingSince.size === 0) {
        logger.debug('No appliance changes detected')
      }

      // Successful discovery = API liveness proof (keeps health signal fresh during quiet streams)
      this.bumpStreamSignal()

      // Refresh the SSE subscription so the stream picks up any set changes
      if (setChanged && this.livestream) {
        this.livestream.refreshSubscription()
      }
    } catch (error) {
      logger.error('Error during appliance discovery:', error)
    }
  }

  // ---------------------------------------------------------------------------
  // Livestream wiring
  // ---------------------------------------------------------------------------

  /**
   * Wire and start the SSE livestream. Must be called once after the initial
   * appliance-init loop. Registers reconnect and event hooks, then starts
   * the connection loop.
   *
   * On every (re)connect: reseed all active appliances (lightly staggered to
   * respect the 10 req/s limit) to close any gap while the stream was down.
   */
  public initializeLivestream(livestream: LivestreamClient): void {
    if (this._livestreamInitialized) return
    this._livestreamInitialized = true
    this.livestream = livestream

    livestream.onReconnect(async () => {
      logger.info('SSE stream connected — reseeding state for all active appliances')
      const appliances = Array.from(this.applianceInstances.values())
      for (const appliance of appliances) {
        if (this.isShuttingDown) break
        const state = await this.client.reseedApplianceState(appliance, this.config.commandStateDelaySeconds * 1000)
        this.trackApiResult(state, Date.now())
        this.writeHealthStatus()
        // Light stagger: ~100 ms between reseeds to avoid hitting the 10 req/s burst limit
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
      }
    })

    livestream.onEvent((event: StreamEvent) => {
      this.handleStreamEvent(event)
    })

    livestream.start()
  }

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  public async [Symbol.asyncDispose](): Promise<void> {
    this.shutdown()
  }

  /**
   * Graceful shutdown: disposes orchestrator-owned resources — clears all
   * pending startup timeouts, stops the livestream, cleans up client state,
   * and disconnects MQTT. External resources (discovery interval, safety-refresh
   * interval, version checker) are owned by the caller (src/index.ts) and must
   * be disposed there.
   */
  public shutdown() {
    if (this.isShuttingDown) return
    this.isShuttingDown = true

    logger.info('Shutting down gracefully...')

    // Clear pending startup/initial-poll timeouts
    for (const t of this.activeTimeouts) {
      clearTimeout(t)
    }
    this.activeTimeouts.clear()

    // Clear pending command re-poll timeouts
    for (const t of this.activeCommandTimeouts) {
      clearTimeout(t)
    }
    this.activeCommandTimeouts.clear()

    // Clear all appliance polling intervals
    for (const interval of this.applianceStateIntervals.values()) {
      clearInterval(interval)
    }
    this.applianceStateIntervals.clear()

    // Stop the SSE livestream (fire-and-forget — asyncDispose in index.ts handles the await)
    if (this.livestream) {
      this.livestream.stop()
    }

    // Cleanup client timeouts
    this.client.cleanup()

    // Unsubscribe from HA birth topic
    if (this._birthRegistered) {
      this.mqtt.unsubscribeAbsolute(this.config.haBirthTopic)
    }

    // Disconnect MQTT
    this.mqtt.disconnect()

    logger.info('Shutdown complete')
  }
}

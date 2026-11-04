import mqtt from 'mqtt'
import type { AppConfig } from './config.js'
import createLogger from './logger.js'

type QoS = 0 | 1 | 2
type MessageHandler = (topic: string, message: Buffer) => void

const logger = createLogger('mqtt')

// configSchema enforces int().min(0).max(2) — narrow without a cast.
const toQoS = (value: number): QoS => (value === 0 || value === 1 ? value : 2)

const ONLINE = 'online'
const OFFLINE = 'offline'
const AVAILABILITY_PUBLISH_OPTIONS: mqtt.IClientPublishOptions = { retain: true, qos: 1 }

// Legacy-discovery check: the broker sends a retained message right after SUBACK.
const RETAINED_GRACE_MS = 500
const RETAINED_CHECK_TIMEOUT_MS = 5_000
// Pause between migration steps so Home Assistant has handled each before the next.
const MIGRATION_STEP_DELAY_MS = 2_000

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface IMqtt {
  client: mqtt.MqttClient
  topicPrefix: string
  /** Retained bridge status: "online" while connected, "offline" via last will or graceful disconnect. */
  availabilityTopic: string
  resolveApplianceTopic(applianceId: string): string
  publish(topicSuffix: string, message: string, options?: mqtt.IClientPublishOptions): void
  publishInfo(message: string, options?: mqtt.IClientPublishOptions): void
  /** Publish (retained) the appliance's device-based discovery config. */
  autoDiscovery(applianceId: string, message: string, options?: mqtt.IClientPublishOptions): void
  /**
   * First discovery publish for an appliance: if a legacy single-component climate config
   * is still retained, migrate it (HA's migrate_discovery handshake) so the entity keeps
   * its history; otherwise just publish.
   */
  initialDiscovery(applianceId: string, message: string): Promise<void>
  subscribe(topicSuffix: string, callback: MessageHandler): Promise<void>
  unsubscribe(topicSuffix: string): void
  /** Subscribe to an absolute topic (no prefix added). */
  subscribeAbsolute(topic: string, callback: MessageHandler): Promise<void>
  /** Unsubscribe from an absolute topic (no prefix added). */
  unsubscribeAbsolute(topic: string): void
  /** Ends the client; resolves once in-flight messages are flushed and it has closed. */
  disconnect(): Promise<void>
  /** Register a callback to be fired on every MQTT 'connect' event (initial + reconnects). */
  onReconnect(callback: () => void): void
  [Symbol.asyncDispose](): Promise<void>
}

class Mqtt implements IMqtt {
  public readonly client: mqtt.MqttClient
  public readonly topicPrefix: string
  public readonly availabilityTopic: string
  private readonly discoveryPrefix: string
  private readonly defaultOptions: mqtt.IClientPublishOptions
  // Exact-topic router: topic -> handler(topic, payload)
  private readonly topicHandlers = new Map<string, MessageHandler>()
  // Fan-out callbacks fired on every 'connect' event (initial connect + reconnects).
  private readonly reconnectCallbacks: Array<() => void> = []

  /** Connects immediately; nothing connects at import time. */
  constructor(settings: AppConfig['mqtt'], discoveryPrefix: AppConfig['homeAssistant']['discoveryPrefix']) {
    this.discoveryPrefix = discoveryPrefix
    this.topicPrefix = `${settings.topicPrefix}appliances`
    this.availabilityTopic = `${this.topicPrefix}/status`
    this.defaultOptions = { retain: settings.retain, qos: toQoS(settings.qos) }
    this.client = mqtt.connect(settings.url, {
      clientId: `${settings.clientId}-electrolux`,
      username: settings.username,
      password: settings.password,
      clean: true,
      // The broker publishes this if the bridge vanishes (crash, network loss), so HA
      // marks every entity unavailable instead of showing the last state forever.
      will: { topic: this.availabilityTopic, payload: OFFLINE, retain: true, qos: 1 },
    })
    this.registerEventHandlers(settings.url)
  }

  private registerEventHandlers(url: string): void {
    this.client
      .on('connect', () => {
        logger.info(`Connected to MQTT broker: ${url}`)
        this._publish(this.availabilityTopic, ONLINE, AVAILABILITY_PUBLISH_OPTIONS)
        for (const cb of this.reconnectCallbacks) {
          cb()
        }
      })
      .on('error', (error) => {
        logger.error('MQTT connection error:', error)
      })
      .on('reconnect', () => {
        logger.info('Reconnecting to MQTT broker...')
      })
      .on('close', () => {
        logger.info('MQTT connection closed')
      })
      .on('offline', () => {
        logger.warn('MQTT client is offline')
      })
      .on('end', () => {
        logger.info('MQTT client has ended')
      })
      .on('message', (incomingTopic, message) => {
        const handler = this.topicHandlers.get(incomingTopic)
        if (!handler) return

        logger.debug('Received message on topic:', incomingTopic, 'Message:', message.toString())
        try {
          handler(incomingTopic, message)
        } catch (e) {
          logger.error('Handler error for topic', incomingTopic, e)
        }
      })
  }

  private _publish(topic: string, message: string, options?: mqtt.IClientPublishOptions) {
    // Drop publishes while disconnected rather than letting the mqtt library
    // queue them unboundedly. State correctness is preferred over message
    // delivery during outages; the orchestrator republishes on reconnect (M9).
    if (!this.client.connected) {
      logger.warn(`Dropping publish to "${topic}" — client is disconnected`)
      return
    }
    try {
      logger.debug('Publishing to topic:', topic, 'Message:', JSON.parse(message))
    } catch {
      logger.debug('Publishing to topic:', topic, 'Message:', message)
    }
    const publishOptions = {
      ...this.defaultOptions,
      ...options,
    }
    this.client.publish(topic, message, publishOptions, (error) => {
      if (error) {
        logger.error('Error publishing message:', error)
      } else {
        logger.debug(`Message published to topic "${topic}" successfully`, publishOptions)
      }
    })
  }

  public resolveApplianceTopic(applianceId: string) {
    return `${this.topicPrefix}/${applianceId}`
  }

  public publish(topicSuffix: string, message: string, options?: mqtt.IClientPublishOptions) {
    this._publish(`${this.topicPrefix}/${topicSuffix}`, message, options)
  }

  public publishInfo(message: string, options?: mqtt.IClientPublishOptions) {
    this._publish(`${this.topicPrefix}/info`, message, { retain: true, qos: 2, ...options })
  }

  public autoDiscovery(applianceId: string, message: string, options?: mqtt.IClientPublishOptions) {
    logger.info(`Publishing auto-discovery config for appliance: ${applianceId}`)
    try {
      const parsed: unknown = JSON.parse(message)
      if (typeof parsed === 'object' && parsed !== null && 'components' in parsed) {
        const { components } = parsed
        if (typeof components === 'object' && components !== null) {
          logger.debug('Auto-discovery components:', Object.keys(components))
        }
      }
    } catch {
      // Debug-only parse: callers always pass JSON.stringify output, but a
      // malformed message must not crash the publish below.
    }
    this._publish(`${this.discoveryPrefix}/device/${applianceId}/config`, message, {
      ...options,
      retain: true,
      qos: 2,
    })
  }

  public async initialDiscovery(applianceId: string, message: string): Promise<void> {
    const legacyTopic = `${this.discoveryPrefix}/climate/${applianceId}/config`
    if (!(await this.hasRetainedMessage(legacyTopic))) {
      this.autoDiscovery(applianceId, message)
      return
    }
    // https://www.home-assistant.io/integrations/mqtt/ "Migration from single component to device discovery":
    // migrate_discovery on the old topic → the device config (same unique_id) → clear the old topic.
    logger.info(`Migrating Home Assistant discovery for ${applianceId}: ${legacyTopic} → device-based discovery`)
    this._publish(legacyTopic, '{"migrate_discovery": true}', AVAILABILITY_PUBLISH_OPTIONS)
    await delay(MIGRATION_STEP_DELAY_MS)
    this.autoDiscovery(applianceId, message)
    await delay(MIGRATION_STEP_DELAY_MS)
    this._publish(legacyTopic, '', AVAILABILITY_PUBLISH_OPTIONS)
    logger.info(`Home Assistant discovery for ${applianceId} migrated`)
  }

  /** Whether a non-empty retained message sits on `topic` (subscribe, wait briefly, unsubscribe). */
  private hasRetainedMessage(topic: string): Promise<boolean> {
    return new Promise((resolve) => {
      let settled = false
      let grace: NodeJS.Timeout | undefined
      const finish = (found: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(grace)
        clearTimeout(overall)
        this.unsubscribeAbsolute(topic)
        resolve(found)
      }
      // Offline, the SUBACK never comes — give up rather than stall appliance start-up.
      const overall = setTimeout(() => finish(false), RETAINED_CHECK_TIMEOUT_MS)
      this.topicHandlers.set(topic, (_topic, payload) => {
        if (payload.length > 0) finish(true)
      })
      this.client.subscribe(topic, (error) => {
        if (error) {
          logger.warn(`Could not check ${topic} for a legacy discovery config:`, error)
          finish(false)
          return
        }
        grace = setTimeout(() => finish(false), RETAINED_GRACE_MS)
      })
    })
  }

  public subscribe(topicSuffix: string, callback: MessageHandler): Promise<void> {
    const topic = `${this.topicPrefix}/${topicSuffix}`
    logger.debug('Subscribing to topic:', topic)

    return new Promise((resolve, reject) => {
      this.client.subscribe(topic, (error) => {
        if (error) {
          logger.error('Error subscribing to topic:', error)
          reject(error)
          return
        }

        logger.info(`Subscribed to topic "${topic}" successfully`)
        this.topicHandlers.set(topic, callback)
        resolve()
      })
    })
  }

  public unsubscribe(topicSuffix: string) {
    const topic = `${this.topicPrefix}/${topicSuffix}`
    logger.debug('Unsubscribing from topic:', topic)

    this.client.unsubscribe(topic, (error) => {
      if (error) {
        logger.error('Error unsubscribing from topic:', error)
      } else {
        logger.info(`Unsubscribed from topic "${topic}" successfully`)
      }
      // Delete after broker confirms (or errors) to preserve the handler
      // for any commands that arrive during the in-flight unsubscribe window.
      // Mirrors the subscribe pattern that adds the handler inside the callback.
      this.topicHandlers.delete(topic)
    })
  }

  public subscribeAbsolute(topic: string, callback: MessageHandler): Promise<void> {
    logger.debug('Subscribing to absolute topic:', topic)

    return new Promise((resolve, reject) => {
      this.client.subscribe(topic, (error) => {
        if (error) {
          logger.error('Error subscribing to absolute topic:', error)
          reject(error)
          return
        }

        logger.info(`Subscribed to absolute topic "${topic}" successfully`)
        this.topicHandlers.set(topic, callback)
        resolve()
      })
    })
  }

  public unsubscribeAbsolute(topic: string) {
    logger.debug('Unsubscribing from absolute topic:', topic)

    this.client.unsubscribe(topic, (error) => {
      if (error) {
        logger.error('Error unsubscribing from absolute topic:', error)
      } else {
        logger.info(`Unsubscribed from absolute topic "${topic}" successfully`)
      }
      this.topicHandlers.delete(topic)
    })
  }

  public disconnect(): Promise<void> {
    // A clean disconnect does not trigger the last will, so announce it ourselves.
    this._publish(this.availabilityTopic, OFFLINE, AVAILABILITY_PUBLISH_OPTIONS)
    return new Promise((resolve) => {
      this.client.end(false, {}, () => {
        logger.info('Disconnected from MQTT broker')
        resolve()
      })
    })
  }

  public [Symbol.asyncDispose](): Promise<void> {
    return this.disconnect()
  }

  public onReconnect(callback: () => void): void {
    this.reconnectCallbacks.push(callback)
  }
}

export default Mqtt

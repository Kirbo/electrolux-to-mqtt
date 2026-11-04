import mqtt from 'mqtt'
import type { AppConfig } from './config.js'
import createLogger from './logger.js'

type QoS = 0 | 1 | 2
type MessageHandler = (topic: string, message: Buffer) => void

const logger = createLogger('mqtt')

// configSchema enforces int().min(0).max(2) — narrow without a cast.
const toQoS = (value: number): QoS => (value === 0 || value === 1 ? value : 2)

export interface IMqtt {
  client: mqtt.MqttClient
  topicPrefix: string
  resolveApplianceTopic(applianceId: string): string
  publish(topicSuffix: string, message: string, options?: mqtt.IClientPublishOptions): void
  publishInfo(message: string, options?: mqtt.IClientPublishOptions): void
  autoDiscovery(applianceId: string, message: string, options?: mqtt.IClientPublishOptions): void
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
  private readonly defaultOptions: mqtt.IClientPublishOptions
  // Exact-topic router: topic -> handler(topic, payload)
  private readonly topicHandlers = new Map<string, MessageHandler>()
  // Fan-out callbacks fired on every 'connect' event (initial connect + reconnects).
  private readonly reconnectCallbacks: Array<() => void> = []

  /** Connects immediately; nothing connects at import time. */
  constructor(settings: AppConfig['mqtt']) {
    this.topicPrefix = `${settings.topicPrefix}appliances`
    this.defaultOptions = { retain: settings.retain, qos: toQoS(settings.qos) }
    this.client = mqtt.connect(settings.url, {
      clientId: `${settings.clientId}-electrolux`,
      username: settings.username,
      password: settings.password,
      clean: true,
    })
    this.registerEventHandlers(settings.url)
  }

  private registerEventHandlers(url: string): void {
    this.client
      .on('connect', () => {
        logger.info(`Connected to MQTT broker: ${url}`)
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
      if (typeof parsed === 'object' && parsed !== null) {
        const topics = parsed as Record<string, unknown>
        logger.debug(`Auto-discovery config topics:`, {
          availability_topic: topics.availability_topic,
          mode_state_topic: topics.mode_state_topic,
          mode_command_topic: topics.mode_command_topic,
          temperature_state_topic: topics.current_temperature_topic,
          temperature_command_topic: topics.temperature_command_topic,
        })
      }
    } catch {
      // Debug-only parse: callers always pass JSON.stringify output, but a
      // malformed message must not crash the publish below.
    }
    this._publish(`homeassistant/climate/${applianceId}/config`, message, {
      ...options,
      retain: true,
      qos: 2,
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

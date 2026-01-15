import mqtt, { IClientPublishOptions } from 'mqtt'
import config from './config.js'
import createLogger from './logger.js'

type QoS = 0 | 1 | 2

const logger = createLogger('mqtt')

const retain = config.mqtt.retain ?? false
const qos = (config.mqtt.qos ?? 0) as QoS

const defaultOptions: IClientPublishOptions = {
  retain,
  qos,
}

const client = mqtt.connect(config.mqtt.url, {
  clientId: `${config.mqtt.clientId ?? config.mqtt.username}-electrolux`,
  username: config.mqtt.username,
  password: config.mqtt.password,
  clean: true,
})

// Exact-topic router: topic -> handler(topic, payload)
const topicHandlers = new Map<string, (topic: string, message: Buffer) => void>()

client
  .on('connect', () => {
    logger.info(`Connected to MQTT broker: ${config.mqtt.url}`)
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
    const handler = topicHandlers.get(incomingTopic)
    if (!handler) return

    logger.debug('Received message on topic:', incomingTopic, 'Message:', message.toString())
    try {
      handler(incomingTopic, message)
    } catch (e) {
      logger.error('Handler error for topic', incomingTopic, e)
    }
  })

export interface IMqtt {
  client: mqtt.MqttClient
  topicPrefix: string
  resolveApplianceTopic(applianceId: string): string
  publish(applianceId: string, message: string, options?: mqtt.IClientPublishOptions): void
  subscribe(applianceId: string, callback: (applianceId: string, message: Buffer) => void): void
  unsubscribe(applianceId: string): void
  disconnect(): void
}

class Mqtt {
  public client: mqtt.MqttClient
  public topicPrefix: string
  public qos: QoS = qos
  public retain: boolean = retain

  constructor() {
    this.client = client
    this.topicPrefix = `${config.mqtt.topicPrefix}appliances`
  }

  private _publish(topic: string, message: string, options?: mqtt.IClientPublishOptions) {
    logger.debug('Publishing to topic:', topic, 'Message:', JSON.parse(message))
    const publishOptions = {
      ...defaultOptions,
      ...options,
    }
    this.client.publish(topic, message, publishOptions, (error) => {
      if (error) {
        logger.error('Error publishing message:', error)
      } else {
        logger.info(`Message published to topic "${topic}" successfully`, publishOptions)
      }
    })
  }

  public resolveApplianceTopic(applianceId: string) {
    return `${this.topicPrefix}/${applianceId}`
  }

  public publish(applianceId: string, message: string, options?: mqtt.IClientPublishOptions) {
    this._publish(`${this.topicPrefix}/${applianceId}`, message, options)
  }

  public autoDiscovery(applianceId: string, message: string, options?: mqtt.IClientPublishOptions) {
    logger.info(`Publishing auto-discovery config for appliance: ${applianceId}`)
    this._publish(`homeassistant/climate/${applianceId}/config`, message, {
      ...options,
      retain: true,
      qos: 2,
    })
  }

  public subscribe(applianceId: string, callback: (topic: string, message: Buffer) => void) {
    const topic = `${this.topicPrefix}/${applianceId}`
    logger.debug('Subscribing to topic:', topic)

    this.client.subscribe(topic, (error) => {
      if (error) {
        logger.error('Error subscribing to topic:', error)
        return
      }

      logger.info(`Subscribed to topic "${topic}" successfully`)
      topicHandlers.set(topic, callback)
    })
  }

  public unsubscribe(applianceId: string) {
    const topic = `${this.topicPrefix}/${applianceId}`
    logger.debug('Unsubscribing from topic:', topic)

    this.client.unsubscribe(topic, (error) => {
      if (error) {
        logger.error('Error unsubscribing from topic:', error)
      } else {
        logger.info(`Unsubscribed from topic "${topic}" successfully`)
      }
    })

    topicHandlers.delete(topic)
  }

  public disconnect() {
    this.client.end(() => {
      logger.info('Disconnected from MQTT broker')
    })
  }
}

export default Mqtt

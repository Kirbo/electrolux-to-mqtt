import mqtt, { IClientPublishOptions } from 'mqtt'
import { QoS } from '../node_modules/.pnpm/mqtt-packet@9.0.2/node_modules/mqtt-packet/types/index.d'
import config from './config'
import createLogger from './logger'

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

export interface iMqtt {
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
    this._publish(`homeassistant/climate/${applianceId}/config`, message, {
      ...options,
      retain: true,
      qos: 2,
    })
  }

  public subscribe(applianceId: string, callback: (applianceId: string, message: Buffer) => void) {
    const topic = `${this.topicPrefix}/${applianceId}`
    logger.debug('Subscribing to topic:', topic)
    this.client.subscribe(topic, (error) => {
      if (error) {
        logger.error('Error subscribing to topic:', error)
      } else {
        logger.info(`Subscribed to topic "${topic}" successfully`)
      }
    })

    this.client.on('message', (topic, message) => {
      logger.debug('Received message on topic:', topic, 'Message:', message.toString())
      callback(topic, message)
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
  }

  public disconnect() {
    this.client.end(() => {
      logger.info('Disconnected from MQTT broker')
    })
  }
}

export default Mqtt

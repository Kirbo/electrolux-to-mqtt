import { version as packageVersion } from '../package.json'
import { cache } from './cache'
import config from './config'
import ElectroluxClient from './electrolux'
import createLogger from './logger'
import Mqtt from './mqtt'
import { SanitizedState } from './types'
import { initializeHelpers } from './utils'

const appVersion = process.env.APP_VERSION ?? packageVersion
const logger = createLogger('app')
const mqtt = new Mqtt()
const client = new ElectroluxClient(mqtt)
const { exampleConfig, autoDiscovery } = initializeHelpers(mqtt)

const refreshInterval = (client.refreshInterval ?? 60) * 1000

const main = async () => {
  logger.info(
    `Starting Electrolux to MQTT version: "${appVersion}", with refresh interval: ${refreshInterval / 1000} seconds`,
  )

  while (!client.isLoggedIn) {
    if (!client.isLoggingIn) {
      try {
        await client.login()
      } catch (error) {
        logger.error('Login failed:', error)
        await new Promise((resolve) => setTimeout(resolve, 10000))
      }
    } else {
      logger.debug('Already logging in, waiting for login to complete...')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  const appliances = await client.getAppliances()

  const totalAppliances = appliances.length
  const intervalDelay = refreshInterval / totalAppliances

  for (const appliance of appliances) {
    const { applianceId } = appliance

    const applianceInfo = await client.getApplianceInfo(applianceId)
    if (!applianceInfo) {
      logger.error('Failed to get appliance info for applianceId:', applianceId)
      continue
    }

    let applianceDiscoveryCallback = undefined
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

        logger.info('Publishing auto-discovery config for appliance:', applianceId)
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
      await client.getApplianceState(applianceId, applianceDiscoveryCallback)
      setInterval(async () => {
        await client.getApplianceState(applianceId, applianceDiscoveryCallback)
      }, refreshInterval)
    }, appliances.indexOf(appliance) * intervalDelay)

    mqtt.subscribe(`${applianceId}/command`, (topic, message) => {
      logger.info('Received command on topic:', topic, 'Message:', message.toString())
      const command = JSON.parse(message.toString())
      client.sendApplianceCommand(applianceId, command)
    })
  }
}

main()

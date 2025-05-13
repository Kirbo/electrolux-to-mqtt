import ElectroluxClient from './electrolux'
import createLogger from './logger'
import Mqtt from './mqtt'
import { initializeHelpers } from './utils'
import config from './config'
import { SanitizedState } from './types'

const logger = createLogger('main')
const mqtt = new Mqtt()
const client = new ElectroluxClient(mqtt)
const { exampleConfig, autoDiscovery } = initializeHelpers(mqtt)

const refreshInterval = (client.refreshInterval ?? 60) * 1000

const main = async () => {
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
      applianceDiscoveryCallback = (state: SanitizedState) => {
        logger.info('Publishing auto-discovery config for appliance:', applianceId)
        mqtt.autoDiscovery(applianceId, JSON.stringify(autoDiscovery(appliance, applianceInfo, state)), {
          retain: true,
          qos: 2,
        })
      }
    } else {
      logger.info('Example config:', exampleConfig(appliance, applianceInfo))
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
      logger.info('Command:', command)
      client.sendApplianceCommand(applianceId, command)
    })
  }
}

main()

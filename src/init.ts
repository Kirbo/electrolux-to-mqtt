import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CONFIG_FILE = resolve(process.cwd(), 'config.yml')

interface EnvVars {
  MQTT_URL?: string
  MQTT_USERNAME?: string
  MQTT_PASSWORD?: string
  ELECTROLUX_API_KEY?: string
  ELECTROLUX_USERNAME?: string
  ELECTROLUX_PASSWORD?: string
  ELECTROLUX_COUNTRY_CODE?: string
  MQTT_CLIENT_ID?: string
  MQTT_TOPIC_PREFIX?: string
  MQTT_RETAIN?: string
  MQTT_QOS?: string
  ELECTROLUX_REFRESH_INTERVAL?: string
  HOME_ASSISTANT_AUTO_DISCOVERY?: string
  LOGGING_SHOW_CHANGES?: string
  LOGGING_IGNORED_KEYS?: string
}

export function initializeConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    console.log('Config file already exists. Skipping creation.')
    return
  }

  const env = process.env as EnvVars
  const MANDATORY_VARS = [
    'MQTT_URL',
    'MQTT_USERNAME',
    'MQTT_PASSWORD',
    'ELECTROLUX_API_KEY',
    'ELECTROLUX_USERNAME',
    'ELECTROLUX_PASSWORD',
    'ELECTROLUX_COUNTRY_CODE',
  ] as const

  const missingVars: string[] = []

  for (const varName of MANDATORY_VARS) {
    if (!env[varName]) {
      missingVars.push(varName)
    }
  }

  if (missingVars.length > 0) {
    console.error('Please set all mandatory environment variables:')
    for (const varName of missingVars) {
      console.error(`  - ${varName}`)
    }
    process.exit(1)
  }

  console.log(`Config file not found. Creating ${CONFIG_FILE}...`)

  // Format LOGGING_IGNORED_KEYS: "key1,key2" -> "key1, key2"
  const formattedIgnoredKeys = env.LOGGING_IGNORED_KEYS ? env.LOGGING_IGNORED_KEYS.split(',').join(', ') : ''

  const configContent = `mqtt:
  clientId: ${env.MQTT_CLIENT_ID || 'electrolux-comfort600'}
  url: ${env.MQTT_URL}
  username: ${env.MQTT_USERNAME}
  password: ${env.MQTT_PASSWORD}
  topicPrefix: ${env.MQTT_TOPIC_PREFIX || 'electrolux_'}
  retain: ${env.MQTT_RETAIN || 'false'}
  qos: ${env.MQTT_QOS || '2'}

electrolux:
  apiKey: ${env.ELECTROLUX_API_KEY}
  username: ${env.ELECTROLUX_USERNAME}
  password: ${env.ELECTROLUX_PASSWORD}
  countryCode: ${env.ELECTROLUX_COUNTRY_CODE}
  refreshInterval: ${env.ELECTROLUX_REFRESH_INTERVAL || '30'}

homeAssistant:
  autoDiscovery: ${env.HOME_ASSISTANT_AUTO_DISCOVERY || 'true'}

logging:
  showChanges: ${env.LOGGING_SHOW_CHANGES || 'true'}
  ignoredKeys: [${formattedIgnoredKeys}]
`

  // Validate refresh interval from env
  const refreshInterval = Number.parseInt(env.ELECTROLUX_REFRESH_INTERVAL || '30', 10)
  if (refreshInterval < 10) {
    console.error('ELECTROLUX_REFRESH_INTERVAL must be at least 10 seconds (current: ' + refreshInterval + ')')
    process.exit(1)
  }
  if (refreshInterval > 3600) {
    console.warn(
      'Warning: ELECTROLUX_REFRESH_INTERVAL is very high (' + refreshInterval + 's). Consider using a lower value.',
    )
  }

  // Validate QoS
  const qos = Number.parseInt(env.MQTT_QOS || '2', 10)
  if (![0, 1, 2].includes(qos)) {
    console.error('MQTT_QOS must be 0, 1, or 2 (current: ' + qos + ')')
    process.exit(1)
  }

  writeFileSync(CONFIG_FILE, configContent, 'utf8')
  console.log('Config file created successfully.')
}

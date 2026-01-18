import fs from 'node:fs'
import path from 'node:path'
import yaml from 'yaml'

export interface AppConfig {
  mqtt: {
    url: string
    clientId?: string
    username: string
    password: string
    topicPrefix?: string
    retain?: boolean
    qos?: number
  }
  electrolux: {
    apiKey: string
    username: string
    password: string
    countryCode: string
    accessToken?: string
    refreshToken?: string
    eat?: Date
    iat?: Date
    refreshInterval?: number
    applianceDiscoveryInterval?: number
  }
  homeAssistant: {
    autoDiscovery: boolean
  }
  logging?: {
    showChanges?: boolean
    ignoredKeys?: string[]
    showVersionNumber?: boolean
    skipCacheLogging?: boolean
  }
}

export interface Tokens {
  accessToken: string
  expiresIn: number
  tokenType: string
  refreshToken: string
  scope: string
  eat: number
  iat: number
}

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
  ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL?: string
  HOME_ASSISTANT_AUTO_DISCOVERY?: string
  LOGGING_SHOW_CHANGES?: string
  LOGGING_IGNORED_KEYS?: string
  LOGGING_SHOW_VERSION_NUMBER?: string
  LOGGING_SKIP_CACHE_LOGGING?: string
}

function createConfigFromEnv(): void {
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
    // Skip exit in test environment
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      process.exit(1)
    }
  }

  console.info('Config file not found. Creating from environment variables...')

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
  applianceDiscoveryInterval: ${env.ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL || '300'}

homeAssistant:
  autoDiscovery: ${env.HOME_ASSISTANT_AUTO_DISCOVERY || 'true'}

logging:
  showChanges: ${env.LOGGING_SHOW_CHANGES || 'true'}
  ignoredKeys: [${formattedIgnoredKeys}]
  showVersionNumber: ${env.LOGGING_SHOW_VERSION_NUMBER || 'true'}
  skipCacheLogging: ${env.LOGGING_SKIP_CACHE_LOGGING || 'true'}
`

  fs.writeFileSync(configPath, configContent, 'utf8')
  console.info('Config file created successfully.')
}

const configPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../config.yml')

// Create config from environment variables if it doesn't exist
if (!fs.existsSync(configPath)) {
  createConfigFromEnv()
}

const file = fs.readFileSync(configPath, 'utf8')
const config = yaml.parse(file) as AppConfig

// Helper function to validate interval range
function validateInterval(value: number | undefined, name: string, min: number, max: number, errors: string[]): void {
  if (value === undefined) return

  if (value < min) {
    errors.push(`${name} must be at least ${min} seconds (current: ${value})`)
  }
  if (value > max) {
    errors.push(`${name} should not exceed ${max} seconds (current: ${value})`)
  }
}

// Helper function to report validation errors
function reportErrors(errors: string[]): void {
  console.error('Configuration validation failed:')
  for (const error of errors) {
    console.error(`  - ${error}`)
  }
  // Skip exit in test environment
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    process.exit(1)
  }
}

// Validate configuration
function validateConfig(cfg: AppConfig): void {
  const errors: string[] = []

  // Validate refresh interval
  validateInterval(cfg.electrolux.refreshInterval, 'electrolux.refreshInterval', 10, 3600, errors)

  // Validate appliance discovery interval
  validateInterval(cfg.electrolux.applianceDiscoveryInterval, 'electrolux.applianceDiscoveryInterval', 60, 3600, errors)

  // Validate QoS
  if (cfg.mqtt.qos !== undefined && ![0, 1, 2].includes(cfg.mqtt.qos)) {
    errors.push(`mqtt.qos must be 0, 1, or 2 (current: ${cfg.mqtt.qos})`)
  }

  // Validate MQTT URL format
  if (cfg.mqtt.url && !/^mqtts?:\/\/.+/.exec(cfg.mqtt.url)) {
    errors.push(`mqtt.url must start with mqtt:// or mqtts:// (current: ${cfg.mqtt.url})`)
  }

  if (errors.length > 0) {
    reportErrors(errors)
  }
}

validateConfig(config)

let tokens: Partial<Tokens> = {}
try {
  const tokensPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../tokens.json')
  if (fs.existsSync(tokensPath)) {
    tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'))
    console.debug('tokens.json loaded')
  }
} catch (error) {
  console.error('Error reading tokens.json:', error)
}

export default {
  ...config,
  electrolux: {
    ...config.electrolux,
    ...tokens,
    eat: tokens.eat ? new Date(tokens.eat * 1000) : undefined,
    iat: tokens.iat ? new Date(tokens.iat * 1000) : undefined,
  },
}

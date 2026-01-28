import fs from 'node:fs'
import path from 'node:path'
import yaml from 'yaml'
import { z } from 'zod'
import init from './init.js'

init()

const configSchema = z.object({
  mqtt: z.object({
    url: z.string().regex(/^mqtts?:\/\/.+/, 'mqtt.url must start with mqtt:// or mqtts://'),
    clientId: z.string().optional(),
    username: z.string(),
    password: z.string(),
    topicPrefix: z.string().optional(),
    retain: z.boolean().optional(),
    qos: z.number().int().min(0).max(2).optional(),
  }),
  electrolux: z.object({
    apiKey: z.string(),
    username: z.string(),
    password: z.string(),
    countryCode: z.string(),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    eat: z.date().optional(),
    iat: z.date().optional(),
    refreshInterval: z
      .number()
      .int()
      .min(10, 'electrolux.refreshInterval must be at least 10 seconds')
      .max(3600, 'electrolux.refreshInterval should not exceed 3600 seconds')
      .optional(),
    applianceDiscoveryInterval: z
      .number()
      .int()
      .min(60, 'electrolux.applianceDiscoveryInterval must be at least 60 seconds')
      .max(3600, 'electrolux.applianceDiscoveryInterval should not exceed 3600 seconds')
      .optional(),
  }),
  homeAssistant: z.object({
    autoDiscovery: z.boolean(),
  }),
  logging: z
    .object({
      showChanges: z.boolean().optional(),
      ignoredKeys: z.array(z.string()).optional(),
      showVersionNumber: z.boolean().optional(),
      skipCacheLogging: z.boolean().optional(),
    })
    .optional(),
  versionCheck: z
    .object({
      checkInterval: z
        .number()
        .int()
        .min(60, 'versionCheck.checkInterval must be at least 60 seconds')
        .max(86400, 'versionCheck.checkInterval should not exceed 86400 seconds')
        .optional(),
      ntfyWebhookUrl: z.string().optional(),
    })
    .optional(),
})

export type AppConfig = z.infer<typeof configSchema>

const tokensSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
  tokenType: z.string(),
  refreshToken: z.string(),
  scope: z.string(),
  eat: z.number(),
  iat: z.number(),
})

export type Tokens = z.infer<typeof tokensSchema>

const envSchema = z.object({
  MQTT_URL: z.string(),
  MQTT_USERNAME: z.string(),
  MQTT_PASSWORD: z.string(),
  ELECTROLUX_API_KEY: z.string(),
  ELECTROLUX_USERNAME: z.string(),
  ELECTROLUX_PASSWORD: z.string(),
  ELECTROLUX_COUNTRY_CODE: z.string(),
  MQTT_CLIENT_ID: z.string().default('electrolux-comfort600'),
  MQTT_TOPIC_PREFIX: z.string().default('electrolux_'),
  MQTT_RETAIN: z
    .string()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true'),
  MQTT_QOS: z.coerce.number().int().min(0).max(2).default(2),
  ELECTROLUX_REFRESH_INTERVAL: z.coerce
    .number()
    .int()
    .min(10, 'ELECTROLUX_REFRESH_INTERVAL must be at least 10 seconds')
    .max(3600, 'ELECTROLUX_REFRESH_INTERVAL should not exceed 3600 seconds')
    .default(30),
  ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL: z.coerce
    .number()
    .int()
    .min(60, 'ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL must be at least 60 seconds')
    .max(3600, 'ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL should not exceed 3600 seconds')
    .default(300),
  HOME_ASSISTANT_AUTO_DISCOVERY: z
    .string()
    .default('true')
    .transform((val) => val.toLowerCase() === 'true'),
  LOGGING_SHOW_CHANGES: z
    .string()
    .default('true')
    .transform((val) => val.toLowerCase() === 'true'),
  LOGGING_IGNORED_KEYS: z
    .string()
    .default('')
    .transform((val) => (val ? val.split(',').map((k) => k.trim()) : [])),
  LOGGING_SHOW_VERSION_NUMBER: z
    .string()
    .default('true')
    .transform((val) => val.toLowerCase() === 'true'),
  LOGGING_SKIP_CACHE_LOGGING: z
    .string()
    .default('true')
    .transform((val) => val.toLowerCase() === 'true'),
  VERSION_CHECK_INTERVAL: z.coerce
    .number()
    .int()
    .min(60, 'VERSION_CHECK_INTERVAL must be at least 60 seconds')
    .max(86400, 'VERSION_CHECK_INTERVAL should not exceed 86400 seconds')
    .default(3600),
  VERSION_CHECK_NTFY_WEBHOOK_URL: z.string().optional(),
})

// Determine which config file to use based on environment
// - CONFIG_FILE_OVERRIDE: Explicitly set config file (for testing)
// - E2E tests: config.yml (user's personal config)
// - Regular tests: config.test.default.yml (committed to repo)
// - Production: config.yml
const getConfigFilename = (): string => {
  // Allow explicit override (used by config.test.ts)
  if (process.env.CONFIG_FILE_OVERRIDE) {
    return process.env.CONFIG_FILE_OVERRIDE
  }
  // E2E tests explicitly request config.yml via environment variable
  if (process.env.E2E_TEST === 'true') {
    return 'config.yml'
  }
  // Regular tests use tests/config.yml
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return 'tests/config.yml'
  }
  // Production uses config.yml
  return 'config.yml'
}

const configFilename = getConfigFilename()
const configPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), `../${configFilename}`)

// Determine which tokens file to use based on environment
// - TOKENS_FILE_OVERRIDE: Explicitly set tokens file (for testing)
// - E2E tests: tokens.json (user's personal tokens)
// - Regular tests: tokens.test.default.json (committed to repo)
// - Production: tokens.json
const getTokensFilename = (): string => {
  // Allow explicit override (used by config.test.ts)
  if (process.env.TOKENS_FILE_OVERRIDE) {
    return process.env.TOKENS_FILE_OVERRIDE
  }
  // E2E tests explicitly request tokens.json via environment variable
  if (process.env.E2E_TEST === 'true') {
    return 'tokens.json'
  }
  // Regular tests use tests/tokens.json
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return 'tests/tokens.json'
  }
  // Production uses tokens.json
  return 'tokens.json'
}

export function createConfigFromEnv(): void {
  console.info('Config file not found. Creating from environment variables...')

  let envConfig: z.infer<typeof envSchema>
  try {
    envConfig = envSchema.parse(process.env)
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Environment variable validation failed:')
      for (const issue of error.issues) {
        const envVar = issue.path.join('.')
        console.error(`  - ${envVar}: ${issue.message}`)
      }
      // Skip exit in test environment
      if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
        process.exit(1)
      }
      return
    }
    throw error
  }

  // Format ignored keys for YAML: ["key1", "key2"] -> "key1, key2"
  const formattedIgnoredKeys = envConfig.LOGGING_IGNORED_KEYS.join(', ')

  const configContent = `mqtt:
  clientId: ${envConfig.MQTT_CLIENT_ID}
  url: ${envConfig.MQTT_URL}
  username: ${envConfig.MQTT_USERNAME}
  password: ${envConfig.MQTT_PASSWORD}
  topicPrefix: ${envConfig.MQTT_TOPIC_PREFIX}
  retain: ${envConfig.MQTT_RETAIN}
  qos: ${envConfig.MQTT_QOS}

electrolux:
  apiKey: ${envConfig.ELECTROLUX_API_KEY}
  username: ${envConfig.ELECTROLUX_USERNAME}
  password: ${envConfig.ELECTROLUX_PASSWORD}
  countryCode: ${envConfig.ELECTROLUX_COUNTRY_CODE}
  refreshInterval: ${envConfig.ELECTROLUX_REFRESH_INTERVAL}
  applianceDiscoveryInterval: ${envConfig.ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL}

homeAssistant:
  autoDiscovery: ${envConfig.HOME_ASSISTANT_AUTO_DISCOVERY}

logging:
  showChanges: ${envConfig.LOGGING_SHOW_CHANGES}
  ignoredKeys: [${formattedIgnoredKeys}]
  showVersionNumber: ${envConfig.LOGGING_SHOW_VERSION_NUMBER}
  skipCacheLogging: ${envConfig.LOGGING_SKIP_CACHE_LOGGING}

versionCheck:
  checkInterval: ${envConfig.VERSION_CHECK_INTERVAL}
${envConfig.VERSION_CHECK_NTFY_WEBHOOK_URL && envConfig.VERSION_CHECK_NTFY_WEBHOOK_URL !== 'https://ntfy.sh/your_topic_here' ? `  ntfyWebhookUrl: ${envConfig.VERSION_CHECK_NTFY_WEBHOOK_URL}` : ''}
`

  fs.writeFileSync(configPath, configContent, 'utf8')
  console.info('Config file created successfully.')
}

// Create config from environment variables if it doesn't exist
if (!fs.existsSync(configPath)) {
  createConfigFromEnv()
}

const file = fs.readFileSync(configPath, 'utf8')
const rawConfig = yaml.parse(file)

// Validate configuration with Zod
let config: AppConfig
try {
  config = configSchema.parse(rawConfig)
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Configuration validation failed:')
    for (const issue of error.issues) {
      const path = issue.path.join('.')
      console.error(`  - ${path}: ${issue.message}`)
    }
    // Skip exit in test environment
    if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
      process.exit(1)
    }
  }
  throw error
}

let tokens: Partial<Tokens> = {}
try {
  const tokensFilename = getTokensFilename()
  const tokensPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), `../${tokensFilename}`)
  if (fs.existsSync(tokensPath)) {
    const rawTokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'))
    tokens = tokensSchema.partial().parse(rawTokens)
    console.debug(`${tokensFilename} loaded`)
  }
} catch (error) {
  const tokensFilename = getTokensFilename()
  console.error(`Error reading ${tokensFilename}:`, error)
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

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'yaml'
import { z } from 'zod'

// configSchema is the single source of truth for structure, constraints, and defaults.
// See CLAUDE.md § Config schema architecture.
const configSchema = z.object({
  mqtt: z.object({
    url: z.string().regex(/^mqtts?:\/\/.+/, 'must start with mqtt:// or mqtts://'),
    clientId: z.string().default('electrolux-comfort600'),
    username: z.string(),
    password: z.string(),
    topicPrefix: z.string().default('electrolux_'),
    retain: z.boolean().default(false),
    qos: z.number().int().min(0).max(2).default(2),
  }),
  electrolux: z
    .object({
      apiKey: z.string(),
      username: z.string(),
      password: z.string(),
      countryCode: z.string().regex(/^[A-Z]{2}$/i, 'must be a two-letter country code (e.g. FI, SE)'),
      refreshInterval: z
        .number()
        .int()
        .min(10, 'must be at least 10 seconds')
        .max(3600, 'should not exceed 3600 seconds')
        .default(30),
      applianceDiscoveryInterval: z
        .number()
        .int()
        .min(60, 'must be at least 60 seconds')
        .max(3600, 'should not exceed 3600 seconds')
        .default(300),
      renewTokenBeforeExpiry: z
        .number()
        .int()
        .min(5, 'must be at least 5 minutes')
        .max(715, 'should not exceed 715 minutes (API tokens last 720 minutes)')
        .default(60),
      commandStateDelaySeconds: z
        .number()
        .int()
        .min(5, 'must be at least 5 seconds (API needs time to register the command)')
        .max(300, 'should not exceed 300 seconds (5 minutes)')
        .default(30),
    })
    .check((ctx) => {
      const renewMinutes = ctx.value.renewTokenBeforeExpiry
      const refreshSeconds = ctx.value.refreshInterval
      const discoverySeconds = ctx.value.applianceDiscoveryInterval
      const longestSeconds = Math.max(refreshSeconds, discoverySeconds)
      const longestIntervalMinutes = longestSeconds / 60
      if (renewMinutes < longestIntervalMinutes) {
        ctx.issues.push({
          code: 'custom',
          input: ctx.value,
          message: `must be at least ${Math.ceil(longestIntervalMinutes)} minutes (the longest polling interval is ${longestSeconds} seconds). Otherwise the token may expire between polls.`,
          path: ['renewTokenBeforeExpiry'],
        })
      }
    }),
  homeAssistant: z.object({
    autoDiscovery: z.boolean().default(true),
    revertStateOnRejection: z.boolean().default(false),
  }),
  logging: z
    .object({
      logLevel: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
      showChanges: z.boolean().default(true),
      ignoredKeys: z.array(z.string()).default([]),
      showVersionNumber: z.boolean().default(true),
      skipCacheLogging: z.boolean().default(true),
      showTimestamp: z.boolean().default(true),
    })
    .optional()
    .transform(
      (val) =>
        val ?? {
          logLevel: 'info' as const,
          showChanges: true,
          ignoredKeys: [] as string[],
          showVersionNumber: true,
          skipCacheLogging: true,
          showTimestamp: true,
        },
    ),
  versionCheck: z
    .object({
      checkInterval: z
        .number()
        .int()
        .min(60, 'must be at least 60 seconds')
        .max(86400, 'should not exceed 86400 seconds')
        .default(3600),
      ntfyWebhookUrl: z.string().optional(),
      updateChannel: z.enum(['stable', 'beta']).default('stable'),
    })
    .optional()
    .transform((val) => val ?? { checkInterval: 3600, updateChannel: 'stable' as const }),
  healthCheck: z
    .object({
      enabled: z.boolean().default(true),
      filePath: z.string().default('/tmp/e2m-health'),
      unHealthyRestartMinutes: z.number().int().min(10).max(1440).default(45),
    })
    .optional()
    .transform((val) => val ?? { enabled: true, filePath: '/tmp/e2m-health', unHealthyRestartMinutes: 45 }),
  telemetryEnabled: z.boolean().default(true),
})

type AppConfig = z.infer<typeof configSchema>

// envSchema handles coercion only — constraints and defaults are in configSchema.
const envSchema = z.object({
  MQTT_URL: z.string(),
  MQTT_USERNAME: z.string(),
  MQTT_PASSWORD: z.string(),
  ELECTROLUX_API_KEY: z.string(),
  ELECTROLUX_USERNAME: z.string(),
  ELECTROLUX_PASSWORD: z.string(),
  ELECTROLUX_COUNTRY_CODE: z.string(),
  MQTT_CLIENT_ID: z.string().optional(),
  MQTT_TOPIC_PREFIX: z.string().optional(),
  MQTT_RETAIN: z
    .string()
    .optional()
    .transform((val) => (val ? val.toLowerCase() === 'true' : undefined)),
  MQTT_QOS: z.coerce.number().optional(),
  ELECTROLUX_REFRESH_INTERVAL: z.coerce.number().optional(),
  ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL: z.coerce.number().optional(),
  ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY: z.coerce.number().optional(),
  ELECTROLUX_COMMAND_STATE_DELAY_SECONDS: z.coerce.number().optional(),
  HOME_ASSISTANT_AUTO_DISCOVERY: z
    .string()
    .optional()
    .transform((val) => (val ? val.toLowerCase() === 'true' : undefined)),
  HOME_ASSISTANT_REVERT_STATE_ON_REJECTION: z
    .string()
    .optional()
    .transform((val) => (val ? val.toLowerCase() === 'true' : undefined)),
  LOG_LEVEL: z.string().optional(),
  LOGGING_SHOW_CHANGES: z
    .string()
    .optional()
    .transform((val) => (val ? val.toLowerCase() === 'true' : undefined)),
  LOGGING_IGNORED_KEYS: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((k) => k.trim()) : undefined)),
  LOGGING_SHOW_VERSION_NUMBER: z
    .string()
    .optional()
    .transform((val) => (val ? val.toLowerCase() === 'true' : undefined)),
  LOGGING_SKIP_CACHE_LOGGING: z
    .string()
    .optional()
    .transform((val) => (val ? val.toLowerCase() === 'true' : undefined)),
  LOGGING_SHOW_TIMESTAMP: z
    .string()
    .optional()
    .transform((val) => (val ? val.toLowerCase() === 'true' : undefined)),
  VERSION_CHECK_INTERVAL: z.coerce.number().optional(),
  VERSION_CHECK_NTFY_WEBHOOK_URL: z.string().optional(),
  VERSION_CHECK_UPDATE_CHANNEL: z.string().optional(),
  HEALTH_CHECK_ENABLED: z
    .string()
    .optional()
    .transform((val) => (val ? val.toLowerCase() === 'true' : undefined)),
  HEALTH_CHECK_FILE_PATH: z.string().optional(),
  HEALTH_CHECK_UNHEALTHY_RESTART_MINUTES: z.coerce.number().optional(),
  E2M_TELEMETRY_ENABLED: z
    .string()
    .optional()
    .transform((val) => (val ? val.toLowerCase() === 'true' : undefined)),
})

// Maps configSchema YAML paths to env var names for error reporting
const configPathToEnvVar: Record<string, string> = {
  'mqtt.url': 'MQTT_URL',
  'mqtt.username': 'MQTT_USERNAME',
  'mqtt.password': 'MQTT_PASSWORD',
  'mqtt.clientId': 'MQTT_CLIENT_ID',
  'mqtt.topicPrefix': 'MQTT_TOPIC_PREFIX',
  'mqtt.retain': 'MQTT_RETAIN',
  'mqtt.qos': 'MQTT_QOS',
  'electrolux.apiKey': 'ELECTROLUX_API_KEY',
  'electrolux.username': 'ELECTROLUX_USERNAME',
  'electrolux.password': 'ELECTROLUX_PASSWORD',
  'electrolux.countryCode': 'ELECTROLUX_COUNTRY_CODE',
  'electrolux.refreshInterval': 'ELECTROLUX_REFRESH_INTERVAL',
  'electrolux.applianceDiscoveryInterval': 'ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL',
  'electrolux.renewTokenBeforeExpiry': 'ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY',
  'electrolux.commandStateDelaySeconds': 'ELECTROLUX_COMMAND_STATE_DELAY_SECONDS',
  'homeAssistant.autoDiscovery': 'HOME_ASSISTANT_AUTO_DISCOVERY',
  'homeAssistant.revertStateOnRejection': 'HOME_ASSISTANT_REVERT_STATE_ON_REJECTION',
  'logging.logLevel': 'LOG_LEVEL',
  'logging.showChanges': 'LOGGING_SHOW_CHANGES',
  'logging.ignoredKeys': 'LOGGING_IGNORED_KEYS',
  'logging.showVersionNumber': 'LOGGING_SHOW_VERSION_NUMBER',
  'logging.skipCacheLogging': 'LOGGING_SKIP_CACHE_LOGGING',
  'logging.showTimestamp': 'LOGGING_SHOW_TIMESTAMP',
  'versionCheck.checkInterval': 'VERSION_CHECK_INTERVAL',
  'versionCheck.ntfyWebhookUrl': 'VERSION_CHECK_NTFY_WEBHOOK_URL',
  'versionCheck.updateChannel': 'VERSION_CHECK_UPDATE_CHANNEL',
  'healthCheck.enabled': 'HEALTH_CHECK_ENABLED',
  'healthCheck.filePath': 'HEALTH_CHECK_FILE_PATH',
  'healthCheck.unHealthyRestartMinutes': 'HEALTH_CHECK_UNHEALTHY_RESTART_MINUTES',
  telemetryEnabled: 'E2M_TELEMETRY_ENABLED',
}

function handleValidationError(error: unknown, useEnvVarNames: boolean): never | undefined {
  if (!(error instanceof z.ZodError)) throw error
  const label = useEnvVarNames ? 'Environment variable validation failed:' : 'Configuration validation failed:'
  console.error(label)
  for (const issue of error.issues) {
    const configPath = issue.path.join('.')
    const fieldLabel = useEnvVarNames ? (configPathToEnvVar[configPath] ?? configPath) : configPath
    console.error(`  - ${fieldLabel}: ${issue.message}`)
  }
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    process.exit(1)
  }
  return undefined
}

// Remove undefined values so configSchema defaults apply
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

// Determine which config file to use based on environment
const getConfigFilename = (): string => {
  if (process.env.CONFIG_FILE_OVERRIDE) {
    return process.env.CONFIG_FILE_OVERRIDE
  }
  if (process.env.E2E_TEST === 'true') {
    return 'config.yml'
  }
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return 'tests/config.yml'
  }
  return 'config.yml'
}

const configFilename = getConfigFilename()
const configPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), `../${configFilename}`)

function buildConfigFromEnv(envConfig: z.infer<typeof envSchema>) {
  return {
    mqtt: stripUndefined({
      url: envConfig.MQTT_URL,
      clientId: envConfig.MQTT_CLIENT_ID,
      username: envConfig.MQTT_USERNAME,
      password: envConfig.MQTT_PASSWORD,
      topicPrefix: envConfig.MQTT_TOPIC_PREFIX,
      retain: envConfig.MQTT_RETAIN,
      qos: envConfig.MQTT_QOS,
    }),
    electrolux: stripUndefined({
      apiKey: envConfig.ELECTROLUX_API_KEY,
      username: envConfig.ELECTROLUX_USERNAME,
      password: envConfig.ELECTROLUX_PASSWORD,
      countryCode: envConfig.ELECTROLUX_COUNTRY_CODE,
      refreshInterval: envConfig.ELECTROLUX_REFRESH_INTERVAL,
      applianceDiscoveryInterval: envConfig.ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL,
      renewTokenBeforeExpiry: envConfig.ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY,
      commandStateDelaySeconds: envConfig.ELECTROLUX_COMMAND_STATE_DELAY_SECONDS,
    }),
    homeAssistant: stripUndefined({
      autoDiscovery: envConfig.HOME_ASSISTANT_AUTO_DISCOVERY,
      revertStateOnRejection: envConfig.HOME_ASSISTANT_REVERT_STATE_ON_REJECTION,
    }),
    logging: stripUndefined({
      logLevel: envConfig.LOG_LEVEL,
      showChanges: envConfig.LOGGING_SHOW_CHANGES,
      ignoredKeys: envConfig.LOGGING_IGNORED_KEYS,
      showVersionNumber: envConfig.LOGGING_SHOW_VERSION_NUMBER,
      skipCacheLogging: envConfig.LOGGING_SKIP_CACHE_LOGGING,
      showTimestamp: envConfig.LOGGING_SHOW_TIMESTAMP,
    }),
    versionCheck: stripUndefined({
      checkInterval: envConfig.VERSION_CHECK_INTERVAL,
      ntfyWebhookUrl: envConfig.VERSION_CHECK_NTFY_WEBHOOK_URL,
      updateChannel: envConfig.VERSION_CHECK_UPDATE_CHANNEL,
    }),
    healthCheck: stripUndefined({
      enabled: envConfig.HEALTH_CHECK_ENABLED,
      filePath: envConfig.HEALTH_CHECK_FILE_PATH,
      unHealthyRestartMinutes: envConfig.HEALTH_CHECK_UNHEALTHY_RESTART_MINUTES,
    }),
    ...(envConfig.E2M_TELEMETRY_ENABLED === undefined ? {} : { telemetryEnabled: envConfig.E2M_TELEMETRY_ENABLED }),
  }
}

export function createConfigFromEnv(): string | undefined {
  console.info('Config file not found. Creating from environment variables...')

  let envConfig: z.infer<typeof envSchema>
  try {
    envConfig = envSchema.parse(process.env)
  } catch (error) {
    return handleValidationError(error, true)
  }

  let validatedConfig: AppConfig
  try {
    validatedConfig = configSchema.parse(buildConfigFromEnv(envConfig))
  } catch (error) {
    return handleValidationError(error, true)
  }

  const configContent = yaml.stringify(validatedConfig)

  try {
    fs.writeFileSync(configPath, configContent, 'utf8')
    console.info('Config file created successfully.')
  } catch {
    console.warn('Could not write config file to disk (read-only filesystem). Using in-memory config.')
  }

  return configContent
}

// Create config from environment variables if it doesn't exist
let generatedConfig: string | undefined
if (!fs.existsSync(configPath)) {
  generatedConfig = createConfigFromEnv()
}

const file = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : generatedConfig

if (!file) {
  console.error('No config file found and could not generate from environment variables.')
  process.exit(1)
}

const rawConfig = yaml.parse(file)

// Validate configuration with Zod
let config: AppConfig
try {
  config = configSchema.parse(rawConfig)
} catch (error) {
  handleValidationError(error, false)
  throw error
}

export default config

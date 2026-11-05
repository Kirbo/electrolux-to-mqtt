import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
      applianceRemovalGracePeriodMinutes: z
        .number()
        .int()
        .min(1, 'must be at least 1 minute')
        .max(1440, 'should not exceed 1440 minutes (24 hours)')
        .default(30),
      apiTimeoutSeconds: z
        .number()
        .int()
        .min(1, 'must be at least 1 second')
        .max(120, 'should not exceed 120 seconds')
        .default(25),
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
  homeAssistant: z
    .object({
      autoDiscovery: z.boolean().default(true),
      revertStateOnRejection: z.boolean().default(false),
      statusTopic: z.string().min(1, 'must be a non-empty MQTT topic string').default('homeassistant/status'),
      birthPayload: z.string().default('online'),
      birthRepublish: z.boolean().default(true),
      discoveryPrefix: z
        .string()
        .regex(/^[^#+/](?:[^#+]*[^#+/])?$/, 'must be an MQTT topic prefix without wildcards or leading/trailing "/"')
        .default('homeassistant'),
    })
    .prefault({}),
  logging: z
    .object({
      logLevel: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
      showChanges: z.boolean().default(true),
      ignoredKeys: z.array(z.string()).default([]),
      showVersionNumber: z.boolean().default(true),
      skipCacheLogging: z.boolean().default(true),
      showTimestamp: z.boolean().default(true),
      // Objects logged with at most this many keys (nested keys and array items included) print
      // inline as JSON; larger ones print one key per line. 0 = always one key per line.
      inlineMaxKeys: z.number().int().min(0, 'must be at least 0 (0 = always one key per line)').default(2),
    })
    // prefault({}): an absent section parses as {} so the field defaults above apply —
    // the defaults live in exactly one place.
    .prefault({}),
  versionCheck: z
    .object({
      checkInterval: z
        .number()
        .int()
        .min(60, 'must be at least 60 seconds')
        .max(86400, 'should not exceed 86400 seconds')
        .default(3600),
      ntfyWebhookUrl: z
        .string()
        .regex(/^https?:\/\/.+/, 'must be an http:// or https:// URL')
        .optional(),
      updateChannel: z.enum(['stable', 'beta']).optional(),
      notifyGracePeriod: z
        .number()
        .int()
        .min(0, 'must be at least 0 seconds (0 = notify immediately)')
        .max(604800, 'should not exceed 604800 seconds (7 days)')
        .default(3600),
    })
    .prefault({}),
  healthCheck: z
    .object({
      enabled: z.boolean().default(true),
      filePath: z.string().default('/tmp/e2m-health'),
      unHealthyRestartMinutes: z.number().int().min(10).max(1440).default(45),
    })
    .prefault({}),
  telemetryEnabled: z.boolean().default(true),
})

export type AppConfig = z.infer<typeof configSchema>

// ── Env-var mode ─────────────────────────────────────────────────────────────
// One table drives the env schema, the env → config mapping and the error labels.
// Coercion only — constraints and defaults stay in configSchema.
type EnvKind = 'required' | 'string' | 'number' | 'bool' | 'list'
const ENV_FIELDS: ReadonlyArray<{ env: string; path: string; kind: EnvKind }> = [
  { env: 'MQTT_URL', path: 'mqtt.url', kind: 'required' },
  { env: 'MQTT_USERNAME', path: 'mqtt.username', kind: 'required' },
  { env: 'MQTT_PASSWORD', path: 'mqtt.password', kind: 'required' },
  { env: 'MQTT_CLIENT_ID', path: 'mqtt.clientId', kind: 'string' },
  { env: 'MQTT_TOPIC_PREFIX', path: 'mqtt.topicPrefix', kind: 'string' },
  { env: 'MQTT_RETAIN', path: 'mqtt.retain', kind: 'bool' },
  { env: 'MQTT_QOS', path: 'mqtt.qos', kind: 'number' },
  { env: 'ELECTROLUX_API_KEY', path: 'electrolux.apiKey', kind: 'required' },
  { env: 'ELECTROLUX_USERNAME', path: 'electrolux.username', kind: 'required' },
  { env: 'ELECTROLUX_PASSWORD', path: 'electrolux.password', kind: 'required' },
  { env: 'ELECTROLUX_COUNTRY_CODE', path: 'electrolux.countryCode', kind: 'required' },
  { env: 'ELECTROLUX_REFRESH_INTERVAL', path: 'electrolux.refreshInterval', kind: 'number' },
  { env: 'ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL', path: 'electrolux.applianceDiscoveryInterval', kind: 'number' },
  { env: 'ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY', path: 'electrolux.renewTokenBeforeExpiry', kind: 'number' },
  { env: 'ELECTROLUX_COMMAND_STATE_DELAY_SECONDS', path: 'electrolux.commandStateDelaySeconds', kind: 'number' },
  {
    env: 'ELECTROLUX_APPLIANCE_REMOVAL_GRACE_PERIOD_MINUTES',
    path: 'electrolux.applianceRemovalGracePeriodMinutes',
    kind: 'number',
  },
  { env: 'ELECTROLUX_API_TIMEOUT_SECONDS', path: 'electrolux.apiTimeoutSeconds', kind: 'number' },
  { env: 'HOME_ASSISTANT_AUTO_DISCOVERY', path: 'homeAssistant.autoDiscovery', kind: 'bool' },
  { env: 'HOME_ASSISTANT_REVERT_STATE_ON_REJECTION', path: 'homeAssistant.revertStateOnRejection', kind: 'bool' },
  { env: 'HA_STATUS_TOPIC', path: 'homeAssistant.statusTopic', kind: 'string' },
  { env: 'HA_BIRTH_PAYLOAD', path: 'homeAssistant.birthPayload', kind: 'string' },
  { env: 'HA_BIRTH_REPUBLISH', path: 'homeAssistant.birthRepublish', kind: 'bool' },
  { env: 'HA_DISCOVERY_PREFIX', path: 'homeAssistant.discoveryPrefix', kind: 'string' },
  { env: 'LOG_LEVEL', path: 'logging.logLevel', kind: 'string' },
  { env: 'LOGGING_SHOW_CHANGES', path: 'logging.showChanges', kind: 'bool' },
  { env: 'LOGGING_IGNORED_KEYS', path: 'logging.ignoredKeys', kind: 'list' },
  { env: 'LOGGING_SHOW_VERSION_NUMBER', path: 'logging.showVersionNumber', kind: 'bool' },
  { env: 'LOGGING_SKIP_CACHE_LOGGING', path: 'logging.skipCacheLogging', kind: 'bool' },
  { env: 'LOGGING_SHOW_TIMESTAMP', path: 'logging.showTimestamp', kind: 'bool' },
  { env: 'LOGGING_INLINE_MAX_KEYS', path: 'logging.inlineMaxKeys', kind: 'number' },
  { env: 'VERSION_CHECK_INTERVAL', path: 'versionCheck.checkInterval', kind: 'number' },
  { env: 'VERSION_CHECK_NTFY_WEBHOOK_URL', path: 'versionCheck.ntfyWebhookUrl', kind: 'string' },
  { env: 'VERSION_CHECK_UPDATE_CHANNEL', path: 'versionCheck.updateChannel', kind: 'string' },
  { env: 'VERSION_CHECK_NOTIFY_GRACE_PERIOD', path: 'versionCheck.notifyGracePeriod', kind: 'number' },
  { env: 'HEALTH_CHECK_ENABLED', path: 'healthCheck.enabled', kind: 'bool' },
  { env: 'HEALTH_CHECK_FILE_PATH', path: 'healthCheck.filePath', kind: 'string' },
  { env: 'HEALTH_CHECK_UNHEALTHY_RESTART_MINUTES', path: 'healthCheck.unHealthyRestartMinutes', kind: 'number' },
  { env: 'E2M_TELEMETRY_ENABLED', path: 'telemetryEnabled', kind: 'bool' },
]

// An empty value (e.g. `MQTT_QOS=` in a compose file) means "unset" for every optional
// kind; without this, z.coerce.number() would turn '' into 0.
const emptyIsUnset = <T extends z.ZodType>(schema: T) =>
  z.preprocess((val) => (val === '' ? undefined : val), schema.optional())

const ENV_KIND_SCHEMAS: Record<EnvKind, z.ZodType> = {
  required: z.string(),
  string: z.string().optional(),
  number: emptyIsUnset(z.coerce.number()),
  // true/1/yes/on/y/enabled · false/0/no/off/n/disabled (case-insensitive); anything else is an error
  bool: emptyIsUnset(z.stringbool()),
  list: emptyIsUnset(z.string().transform((val) => val.split(',').map((k) => k.trim()))),
}

const envSchema = z.object(Object.fromEntries(ENV_FIELDS.map((f) => [f.env, ENV_KIND_SCHEMAS[f.kind]])))

const pathToEnvVar = new Map(ENV_FIELDS.map((f) => [f.path, f.env]))

/** Validation failure, already formatted for the user (env-var or config-file field names). */
export class ConfigError extends Error {
  readonly heading: string
  readonly details: readonly string[]

  constructor(heading: string, details: readonly string[]) {
    const lines = details.map((d) => `  - ${d}`).join('\n')
    super(`${heading}\n${lines}`)
    this.name = 'ConfigError'
    this.heading = heading
    this.details = details
  }
}

function toConfigError(error: z.ZodError, useEnvVarNames: boolean): ConfigError {
  const heading = useEnvVarNames ? 'Environment variable validation failed:' : 'Configuration validation failed:'
  const details = error.issues.map((issue) => {
    const configPath = issue.path.join('.')
    const label = useEnvVarNames ? (pathToEnvVar.get(configPath) ?? configPath) : configPath
    return `${label}: ${issue.message}`
  })
  return new ConfigError(heading, details)
}

/**
 * Docker-secrets convention: `<NAME>_FILE=/run/secrets/x` supplies NAME from that file
 * (one trailing newline stripped). Setting both NAME and NAME_FILE is an error.
 */
function resolveFileEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const resolved: NodeJS.ProcessEnv = { ...env }
  const problems: string[] = []
  for (const { env: name } of ENV_FIELDS) {
    const filePath = env[`${name}_FILE`]
    if (!filePath) continue
    if (env[name]) {
      problems.push(`${name}: set either ${name} or ${name}_FILE, not both`)
      continue
    }
    try {
      resolved[name] = fs.readFileSync(filePath, 'utf8').replace(/\r?\n$/, '')
    } catch (error) {
      problems.push(`${name}_FILE: cannot read ${filePath} (${String(error)})`)
    }
  }
  if (problems.length > 0) throw new ConfigError('Environment variable validation failed:', problems)
  return resolved
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function setPath(target: Record<string, unknown>, dottedPath: string, value: unknown): void {
  const keys = dottedPath.split('.')
  const last = keys.pop()
  if (last === undefined) return
  let node = target
  for (const key of keys) {
    const child = node[key]
    if (isRecord(child)) {
      node = child
    } else {
      const created: Record<string, unknown> = {}
      node[key] = created
      node = created
    }
  }
  node[last] = value
}

/** Build and validate the config from environment variables (env-var mode). Throws ConfigError. */
export function configFromEnv(env: NodeJS.ProcessEnv): AppConfig {
  const parsedEnv = envSchema.safeParse(resolveFileEnv(env))
  if (!parsedEnv.success) throw toConfigError(parsedEnv.error, true)

  // Unset values are skipped so configSchema defaults apply.
  const raw: Record<string, unknown> = {}
  for (const { env: name, path: configPath } of ENV_FIELDS) {
    const value = parsedEnv.data[name]
    if (value !== undefined) setPath(raw, configPath, value)
  }
  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) throw toConfigError(parsed.error, true)
  return parsed.data
}

/** Parse and validate a YAML config file's contents (file mode). Throws ConfigError. */
export function parseConfigFile(text: string): AppConfig {
  const parsed = configSchema.safeParse(yaml.parse(text))
  if (!parsed.success) throw toConfigError(parsed.error, false)
  return parsed.data
}

/**
 * Load the config: `config.yml` next to the package root (or CONFIG_FILE_OVERRIDE,
 * relative to it) when it exists, otherwise environment variables — never mixed.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const filename = env.CONFIG_FILE_OVERRIDE || 'config.yml'
  const configPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', filename)
  if (fs.existsSync(configPath)) {
    return parseConfigFile(fs.readFileSync(configPath, 'utf8'))
  }
  console.info('Config file not found. Loading config from environment variables.')
  return configFromEnv(env)
}

function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig()
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(error.heading)
    for (const detail of error.details) console.error(`  - ${detail}`)
    process.exit(1)
  }
}

const config: AppConfig = loadConfigOrExit()

export default config

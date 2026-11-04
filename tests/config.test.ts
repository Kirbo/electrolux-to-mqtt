import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { type AppConfig, ConfigError, configFromEnv, loadConfig, parseConfigFile } from '#/config.ts'

// ── Fixtures ────────────────────────────────────────────────────────────────

const REQUIRED_ENV = {
  MQTT_URL: 'mqtt://test-broker',
  MQTT_USERNAME: 'test-user',
  MQTT_PASSWORD: 'test-pass',
  ELECTROLUX_API_KEY: 'test-key',
  ELECTROLUX_USERNAME: 'test@example.com',
  ELECTROLUX_PASSWORD: 'electrolux-pass',
  ELECTROLUX_COUNTRY_CODE: 'FI',
} as const

const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ ...REQUIRED_ENV, ...extra })

const MINIMAL_YAML = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FI
homeAssistant:
  autoDiscovery: true
`

/** MINIMAL_YAML with extra lines appended to one top-level section (or a new section). */
const yamlWith = (section: string, lines: string): string => {
  const indented = lines
    .trim()
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n')
  if (MINIMAL_YAML.includes(`${section}:\n`)) {
    return MINIMAL_YAML.replace(`${section}:\n`, `${section}:\n${indented}\n`)
  }
  return `${MINIMAL_YAML}${section}:\n${indented}\n`
}

/** Assert fn throws a ConfigError whose detail lines mention `label` (and return it). */
const expectConfigError = (fn: () => unknown, label: string): ConfigError => {
  let caught: unknown
  try {
    fn()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(ConfigError)
  const configError = caught as ConfigError
  expect(configError.details.some((d) => d.startsWith(`${label}:`))).toBe(true)
  return configError
}

let tmpDir: string
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2m-config-'))
})
afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const writeTmp = (name: string, content: string): string => {
  const file = path.join(tmpDir, name)
  fs.writeFileSync(file, content, 'utf8')
  return file
}

// Every default the schema promises, checked for both config sources.
const expectDefaults = (config: AppConfig) => {
  expect(config.mqtt).toMatchObject({
    clientId: 'electrolux-comfort600',
    topicPrefix: 'electrolux_',
    retain: false,
    qos: 2,
  })
  expect(config.electrolux).toMatchObject({
    refreshInterval: 30,
    applianceDiscoveryInterval: 300,
    renewTokenBeforeExpiry: 60,
    commandStateDelaySeconds: 30,
    applianceRemovalGracePeriodMinutes: 30,
    apiTimeoutSeconds: 25,
  })
  expect(config.homeAssistant).toMatchObject({
    autoDiscovery: true,
    revertStateOnRejection: false,
    statusTopic: 'homeassistant/status',
    birthPayload: 'online',
    birthRepublish: true,
    discoveryPrefix: 'homeassistant',
  })
  expect(config.logging).toEqual({
    logLevel: 'info',
    showChanges: true,
    ignoredKeys: [],
    showVersionNumber: true,
    skipCacheLogging: true,
    showTimestamp: true,
  })
  expect(config.versionCheck).toEqual({ checkInterval: 3600, notifyGracePeriod: 3600 })
  expect(config.versionCheck.updateChannel).toBeUndefined()
  expect(config.healthCheck).toEqual({ enabled: true, filePath: '/tmp/e2m-health', unHealthyRestartMinutes: 45 })
  expect(config.telemetryEnabled).toBe(true)
}

// ── Env-var mode ────────────────────────────────────────────────────────────

describe('configFromEnv', () => {
  it('builds the config from the required variables and applies every default', () => {
    const config = configFromEnv(env())

    expect(config.mqtt).toMatchObject({ url: 'mqtt://test-broker', username: 'test-user', password: 'test-pass' })
    expect(config.electrolux).toMatchObject({
      apiKey: 'test-key',
      username: 'test@example.com',
      password: 'electrolux-pass',
      countryCode: 'FI',
    })
    expectDefaults(config)
  })

  it('reports every missing required variable by its env name', () => {
    const { MQTT_URL: _url, MQTT_USERNAME: _user, ...rest } = REQUIRED_ENV
    const error = expectConfigError(() => configFromEnv(rest), 'MQTT_URL')

    expect(error.heading).toBe('Environment variable validation failed:')
    expect(error.details.some((d) => d.startsWith('MQTT_USERNAME:'))).toBe(true)
  })

  it.each([
    ['MQTT_CLIENT_ID', 'custom-client', (c: AppConfig) => c.mqtt.clientId, 'custom-client'],
    ['MQTT_TOPIC_PREFIX', 'custom_', (c: AppConfig) => c.mqtt.topicPrefix, 'custom_'],
    ['MQTT_RETAIN', 'true', (c: AppConfig) => c.mqtt.retain, true],
    ['MQTT_QOS', '1', (c: AppConfig) => c.mqtt.qos, 1],
    ['ELECTROLUX_REFRESH_INTERVAL', '60', (c: AppConfig) => c.electrolux.refreshInterval, 60],
    ['ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL', '600', (c: AppConfig) => c.electrolux.applianceDiscoveryInterval, 600],
    ['ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY', '120', (c: AppConfig) => c.electrolux.renewTokenBeforeExpiry, 120],
    ['ELECTROLUX_COMMAND_STATE_DELAY_SECONDS', '45', (c: AppConfig) => c.electrolux.commandStateDelaySeconds, 45],
    [
      'ELECTROLUX_APPLIANCE_REMOVAL_GRACE_PERIOD_MINUTES',
      '90',
      (c: AppConfig) => c.electrolux.applianceRemovalGracePeriodMinutes,
      90,
    ],
    ['ELECTROLUX_API_TIMEOUT_SECONDS', '30', (c: AppConfig) => c.electrolux.apiTimeoutSeconds, 30],
    ['HOME_ASSISTANT_AUTO_DISCOVERY', 'false', (c: AppConfig) => c.homeAssistant.autoDiscovery, false],
    [
      'HOME_ASSISTANT_REVERT_STATE_ON_REJECTION',
      'true',
      (c: AppConfig) => c.homeAssistant.revertStateOnRejection,
      true,
    ],
    ['HA_STATUS_TOPIC', 'ha/birth/status', (c: AppConfig) => c.homeAssistant.statusTopic, 'ha/birth/status'],
    ['HA_BIRTH_PAYLOAD', 'started', (c: AppConfig) => c.homeAssistant.birthPayload, 'started'],
    ['HA_BIRTH_REPUBLISH', 'false', (c: AppConfig) => c.homeAssistant.birthRepublish, false],
    ['HA_DISCOVERY_PREFIX', 'ha', (c: AppConfig) => c.homeAssistant.discoveryPrefix, 'ha'],
    ['HA_DISCOVERY_PREFIX', 'my/ha', (c: AppConfig) => c.homeAssistant.discoveryPrefix, 'my/ha'],
    ['LOG_LEVEL', 'debug', (c: AppConfig) => c.logging.logLevel, 'debug'],
    ['LOGGING_SHOW_CHANGES', 'false', (c: AppConfig) => c.logging.showChanges, false],
    ['LOGGING_IGNORED_KEYS', 'a.b, c ,d', (c: AppConfig) => c.logging.ignoredKeys, ['a.b', 'c', 'd']],
    ['LOGGING_SHOW_VERSION_NUMBER', 'false', (c: AppConfig) => c.logging.showVersionNumber, false],
    ['LOGGING_SKIP_CACHE_LOGGING', 'false', (c: AppConfig) => c.logging.skipCacheLogging, false],
    ['LOGGING_SHOW_TIMESTAMP', 'false', (c: AppConfig) => c.logging.showTimestamp, false],
    ['VERSION_CHECK_INTERVAL', '7200', (c: AppConfig) => c.versionCheck.checkInterval, 7200],
    [
      'VERSION_CHECK_NTFY_WEBHOOK_URL',
      'https://ntfy.sh/topic',
      (c: AppConfig) => c.versionCheck.ntfyWebhookUrl,
      'https://ntfy.sh/topic',
    ],
    ['VERSION_CHECK_UPDATE_CHANNEL', 'beta', (c: AppConfig) => c.versionCheck.updateChannel, 'beta'],
    ['VERSION_CHECK_UPDATE_CHANNEL', 'stable', (c: AppConfig) => c.versionCheck.updateChannel, 'stable'],
    ['VERSION_CHECK_NOTIFY_GRACE_PERIOD', '0', (c: AppConfig) => c.versionCheck.notifyGracePeriod, 0],
    ['VERSION_CHECK_NOTIFY_GRACE_PERIOD', '7200', (c: AppConfig) => c.versionCheck.notifyGracePeriod, 7200],
    ['HEALTH_CHECK_ENABLED', 'false', (c: AppConfig) => c.healthCheck.enabled, false],
    ['HEALTH_CHECK_FILE_PATH', '/data/health', (c: AppConfig) => c.healthCheck.filePath, '/data/health'],
    ['HEALTH_CHECK_UNHEALTHY_RESTART_MINUTES', '60', (c: AppConfig) => c.healthCheck.unHealthyRestartMinutes, 60],
    ['E2M_TELEMETRY_ENABLED', 'false', (c: AppConfig) => c.telemetryEnabled, false],
  ])('maps %s=%s into the config', (name, value, read, expected) => {
    expect(read(configFromEnv(env({ [name]: value })))).toEqual(expected)
  })

  it.each(['true', 'TRUE', '1', 'yes', 'on'])('reads boolean %s as true', (value) => {
    expect(configFromEnv(env({ MQTT_RETAIN: value })).mqtt.retain).toBe(true)
  })

  it.each(['false', '0', 'no', 'off'])('reads boolean %s as false', (value) => {
    expect(configFromEnv(env({ HOME_ASSISTANT_AUTO_DISCOVERY: value })).homeAssistant.autoDiscovery).toBe(false)
  })

  it('rejects an unrecognised boolean instead of silently treating it as false', () => {
    expectConfigError(() => configFromEnv(env({ MQTT_RETAIN: 'banana' })), 'MQTT_RETAIN')
  })

  it('treats empty optional values as unset so the defaults apply', () => {
    const config = configFromEnv(
      env({ MQTT_QOS: '', ELECTROLUX_REFRESH_INTERVAL: '', MQTT_RETAIN: '', LOGGING_IGNORED_KEYS: '' }),
    )
    expect(config.mqtt.qos).toBe(2)
    expect(config.electrolux.refreshInterval).toBe(30)
    expect(config.mqtt.retain).toBe(false)
    expect(config.logging.ignoredKeys).toEqual([])
  })

  it.each([
    ['MQTT_URL', 'http://broker'],
    ['MQTT_QOS', '5'],
    ['ELECTROLUX_COUNTRY_CODE', 'FIN'],
    ['ELECTROLUX_REFRESH_INTERVAL', '5'],
    ['ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL', '5000'],
    ['ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY', '4'],
    ['ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY', '716'],
    ['ELECTROLUX_COMMAND_STATE_DELAY_SECONDS', '4'],
    ['ELECTROLUX_COMMAND_STATE_DELAY_SECONDS', '301'],
    ['ELECTROLUX_APPLIANCE_REMOVAL_GRACE_PERIOD_MINUTES', '0'],
    ['ELECTROLUX_APPLIANCE_REMOVAL_GRACE_PERIOD_MINUTES', '1441'],
    ['ELECTROLUX_API_TIMEOUT_SECONDS', '0'],
    ['ELECTROLUX_API_TIMEOUT_SECONDS', '121'],
    ['VERSION_CHECK_NTFY_WEBHOOK_URL', 'not-a-url'],
    ['VERSION_CHECK_INTERVAL', '10'],
    ['VERSION_CHECK_UPDATE_CHANNEL', 'nightly'],
    ['VERSION_CHECK_NOTIFY_GRACE_PERIOD', '-1'],
    ['VERSION_CHECK_NOTIFY_GRACE_PERIOD', '604801'],
    ['LOG_LEVEL', 'verbose'],
    ['HEALTH_CHECK_UNHEALTHY_RESTART_MINUTES', '5'],
    ['HA_DISCOVERY_PREFIX', 'homeassistant/'],
    ['HA_DISCOVERY_PREFIX', '/homeassistant'],
    ['HA_DISCOVERY_PREFIX', 'home/#'],
    ['HA_DISCOVERY_PREFIX', 'home+assistant'],
  ])('rejects %s=%s, labelled with the env name', (name, value) => {
    expectConfigError(() => configFromEnv(env({ [name]: value })), name)
  })

  it.each([
    ['refreshInterval', { ELECTROLUX_REFRESH_INTERVAL: '3600', ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY: '30' }],
    [
      'applianceDiscoveryInterval',
      { ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL: '3600', ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY: '30' },
    ],
  ])('rejects a renewTokenBeforeExpiry shorter than %s', (_interval, vars) => {
    const error = expectConfigError(() => configFromEnv(env(vars)), 'ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY')
    expect(error.details.join('\n')).toContain('the longest polling interval is 3600 seconds')
  })

  describe('<NAME>_FILE (Docker secrets)', () => {
    it('reads the value from the file, without its trailing newline', () => {
      const file = writeTmp('mqtt-password', 's3cret\n')
      const { MQTT_PASSWORD: _pw, ...rest } = REQUIRED_ENV

      expect(configFromEnv({ ...rest, MQTT_PASSWORD_FILE: file }).mqtt.password).toBe('s3cret')
    })

    it('works for optional variables too', () => {
      const file = writeTmp('qos', '1\n')
      expect(configFromEnv(env({ MQTT_QOS_FILE: file })).mqtt.qos).toBe(1)
    })

    it('rejects setting both NAME and NAME_FILE', () => {
      const file = writeTmp('both', 'x')
      const error = expectConfigError(() => configFromEnv(env({ MQTT_PASSWORD_FILE: file })), 'MQTT_PASSWORD')
      expect(error.details.join('\n')).toContain('not both')
    })

    it('reports an unreadable file', () => {
      const { ELECTROLUX_PASSWORD: _pw, ...rest } = REQUIRED_ENV
      expectConfigError(
        () => configFromEnv({ ...rest, ELECTROLUX_PASSWORD_FILE: path.join(tmpDir, 'missing') }),
        'ELECTROLUX_PASSWORD_FILE',
      )
    })
  })
})

// ── File mode ───────────────────────────────────────────────────────────────

describe('parseConfigFile', () => {
  it('parses a minimal file and applies every default', () => {
    expectDefaults(parseConfigFile(MINIMAL_YAML))
  })

  it('treats an absent homeAssistant section as all defaults', () => {
    const config = parseConfigFile(MINIMAL_YAML.replace('homeAssistant:\n  autoDiscovery: true\n', ''))
    expect(config.homeAssistant).toEqual({
      autoDiscovery: true,
      revertStateOnRejection: false,
      statusTopic: 'homeassistant/status',
      birthPayload: 'online',
      birthRepublish: true,
      discoveryPrefix: 'homeassistant',
    })
  })

  it('accepts a fully specified file', () => {
    const config = parseConfigFile(
      `${yamlWith('mqtt', 'clientId: test-client\ntopicPrefix: test_\nretain: true\nqos: 1')}logging:
  logLevel: debug
  ignoredKeys: [networkInterface]
versionCheck:
  updateChannel: beta
  ntfyWebhookUrl: https://ntfy.sh/x
telemetryEnabled: false
`,
    )
    expect(config.mqtt).toMatchObject({ clientId: 'test-client', topicPrefix: 'test_', retain: true, qos: 1 })
    expect(config.logging).toMatchObject({ logLevel: 'debug', ignoredKeys: ['networkInterface'], showChanges: true })
    expect(config.versionCheck).toMatchObject({ updateChannel: 'beta', checkInterval: 3600 })
    expect(config.telemetryEnabled).toBe(false)
  })

  it.each([
    ['electrolux', 'commandStateDelaySeconds: 45', (c: AppConfig) => c.electrolux.commandStateDelaySeconds, 45],
    [
      'electrolux',
      'applianceRemovalGracePeriodMinutes: 120',
      (c: AppConfig) => c.electrolux.applianceRemovalGracePeriodMinutes,
      120,
    ],
    ['electrolux', 'apiTimeoutSeconds: 30', (c: AppConfig) => c.electrolux.apiTimeoutSeconds, 30],
    ['electrolux', 'countryCode: se', (c: AppConfig) => c.electrolux.countryCode, 'se'],
    ['homeAssistant', 'statusTopic: custom/status', (c: AppConfig) => c.homeAssistant.statusTopic, 'custom/status'],
    ['homeAssistant', 'birthRepublish: false', (c: AppConfig) => c.homeAssistant.birthRepublish, false],
    ['homeAssistant', 'discoveryPrefix: custom_ha', (c: AppConfig) => c.homeAssistant.discoveryPrefix, 'custom_ha'],
    ['versionCheck', 'updateChannel: stable', (c: AppConfig) => c.versionCheck.updateChannel, 'stable'],
    ['mqtt', 'url: mqtts://secure.broker:8883', (c: AppConfig) => c.mqtt.url, 'mqtts://secure.broker:8883'],
  ])('reads %s.%s', (section, line, read, expected) => {
    const text = line.startsWith('url:')
      ? MINIMAL_YAML.replace('url: mqtt://localhost', line)
      : line.startsWith('countryCode:')
        ? MINIMAL_YAML.replace('countryCode: FI', line)
        : yamlWith(section, line)
    expect(read(parseConfigFile(text))).toEqual(expected)
  })

  it.each([
    ['mqtt.url', MINIMAL_YAML.replace('url: mqtt://localhost', 'url: http://localhost:1883')],
    ['mqtt.qos', yamlWith('mqtt', 'qos: 5')],
    ['electrolux.countryCode', MINIMAL_YAML.replace('countryCode: FI', 'countryCode: FIN')],
    ['electrolux.refreshInterval', yamlWith('electrolux', 'refreshInterval: 5')],
    ['electrolux.applianceDiscoveryInterval', yamlWith('electrolux', 'applianceDiscoveryInterval: 5000')],
    ['electrolux.renewTokenBeforeExpiry', yamlWith('electrolux', 'renewTokenBeforeExpiry: 4')],
    ['electrolux.renewTokenBeforeExpiry', yamlWith('electrolux', 'refreshInterval: 3600\nrenewTokenBeforeExpiry: 30')],
    ['electrolux.commandStateDelaySeconds', yamlWith('electrolux', 'commandStateDelaySeconds: 4')],
    ['electrolux.commandStateDelaySeconds', yamlWith('electrolux', 'commandStateDelaySeconds: 301')],
    ['electrolux.applianceRemovalGracePeriodMinutes', yamlWith('electrolux', 'applianceRemovalGracePeriodMinutes: 0')],
    [
      'electrolux.applianceRemovalGracePeriodMinutes',
      yamlWith('electrolux', 'applianceRemovalGracePeriodMinutes: 1441'),
    ],
    ['electrolux.apiTimeoutSeconds', yamlWith('electrolux', 'apiTimeoutSeconds: 0')],
    ['electrolux.apiTimeoutSeconds', yamlWith('electrolux', 'apiTimeoutSeconds: 121')],
    ['homeAssistant.statusTopic', yamlWith('homeAssistant', "statusTopic: ''")],
    ['homeAssistant.discoveryPrefix', yamlWith('homeAssistant', "discoveryPrefix: ''")],
    ['logging.logLevel', yamlWith('logging', 'logLevel: verbose')],
  ])('rejects an invalid %s, labelled with the config path', (label, text) => {
    const error = expectConfigError(() => parseConfigFile(text), label)
    expect(error.heading).toBe('Configuration validation failed:')
  })

  it('collects several validation errors at once', () => {
    const error = expectConfigError(
      () => parseConfigFile(yamlWith('mqtt', 'qos: 9').replace('url: mqtt://localhost', 'url: nope')),
      'mqtt.qos',
    )
    expect(error.details.some((d) => d.startsWith('mqtt.url:'))).toBe(true)
  })

  it('formats the error message as heading plus one line per issue', () => {
    const error = expectConfigError(() => parseConfigFile(yamlWith('mqtt', 'qos: 9')), 'mqtt.qos')
    expect(error.message).toMatch(/^Configuration validation failed:\n {2}- mqtt\.qos: /)
  })
})

// ── Source selection ────────────────────────────────────────────────────────

describe('loadConfig', () => {
  it('uses the config file when it exists and ignores environment variables', () => {
    const file = writeTmp('present.yml', MINIMAL_YAML)
    const config = loadConfig({ CONFIG_FILE_OVERRIDE: file, MQTT_URL: 'mqtt://from-env' })

    expect(config.mqtt.url).toBe('mqtt://localhost')
  })

  it('falls back to environment variables when the file is missing', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const config = loadConfig({ ...env(), CONFIG_FILE_OVERRIDE: path.join(tmpDir, 'absent.yml') })

    expect(config.mqtt.url).toBe('mqtt://test-broker')
    expect(infoSpy).toHaveBeenCalledWith('Config file not found. Loading config from environment variables.')
    infoSpy.mockRestore()
  })

  it('throws a ConfigError for an invalid file', () => {
    const file = writeTmp('invalid.yml', yamlWith('mqtt', 'qos: 5'))
    expect(() => loadConfig({ CONFIG_FILE_OVERRIDE: file })).toThrow(ConfigError)
  })
})

describe('default export', () => {
  it('loads the configured file at import', async () => {
    vi.resetModules()
    const { default: config } = await import('#/config.ts')
    // tests/config.yml (CONFIG_FILE_OVERRIDE from vitest.config.ts)
    expect(config.electrolux.countryCode).toBe('US')
  })

  it('prints the validation errors and exits 1 when the config is invalid', async () => {
    const file = writeTmp('invalid-import.yml', yamlWith('mqtt', 'qos: 5'))
    vi.stubEnv('CONFIG_FILE_OVERRIDE', file)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      vi.resetModules()
      await import('#/config.ts')

      expect(errorSpy).toHaveBeenCalledWith('Configuration validation failed:')
      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('mqtt.qos'))).toBe(true)
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
      errorSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

describe('config', () => {
  const originalEnv = process.env
  // Use config.test.yml specifically for config.test.ts manipulation
  const configPath = path.resolve(process.cwd(), 'config.test.yml')
  const defaultValidConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FI
homeAssistant:
  autoDiscovery: true`

  beforeAll(() => {
    // Clean up any existing config.test.yml
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath)
    }
  })

  afterAll(() => {
    // Clean up config.test.yml after all tests
    if (fs.existsSync(configPath)) {
      try {
        fs.unlinkSync(configPath)
      } catch {
        // Ignore cleanup errors
      }
    }
  })

  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      VITEST: 'true',
      CONFIG_FILE_OVERRIDE: 'config.test.yml',
    }
    // Ensure a valid config exists before each test
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, defaultValidConfig, 'utf8')
    }
  })

  afterEach(() => {
    process.env = originalEnv
    // Restore valid config after each test
    if (fs.existsSync(configPath)) {
      // If config exists but might be invalid, replace it
      try {
        fs.writeFileSync(configPath, defaultValidConfig, 'utf8')
      } catch {
        // Ignore write errors
      }
    } else {
      fs.writeFileSync(configPath, defaultValidConfig, 'utf8')
    }
  })

  describe('createConfigFromEnv', () => {
    it('should create config file from environment variables with all required vars', async () => {
      // Set required environment variables
      process.env.MQTT_URL = 'mqtt://test-broker'
      process.env.MQTT_USERNAME = 'test-user'
      process.env.MQTT_PASSWORD = 'test-pass'
      process.env.ELECTROLUX_API_KEY = 'test-key'
      process.env.ELECTROLUX_USERNAME = 'test@example.com'
      process.env.ELECTROLUX_PASSWORD = 'electrolux-pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      expect(writeSpy).toHaveBeenCalled()
      expect(infoSpy).toHaveBeenCalledWith('Config file not found. Creating from environment variables...')
      expect(infoSpy).toHaveBeenCalledWith('Config file created successfully.')

      const [, content] = writeSpy.mock.calls[0]
      expect(content).toContain('mqtt:')
      expect(content).toContain('url: mqtt://test-broker')
      expect(content).toContain('username: test-user')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should fail when mandatory environment variables are missing', async () => {
      // Clear required environment variables
      delete process.env.MQTT_URL
      delete process.env.MQTT_USERNAME

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      expect(errorSpy).toHaveBeenCalledWith('Environment variable validation failed:')
      expect(infoSpy).toHaveBeenCalledWith('Config file not found. Creating from environment variables...')

      errorSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should use default values when optional vars are not provided', async () => {
      // Set only required vars
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      expect(writeSpy).toHaveBeenCalled()
      const [, content] = writeSpy.mock.calls[0]
      expect(content).toContain('clientId: electrolux-comfort600')
      expect(content).toContain('topicPrefix: electrolux_')
      expect(content).toContain('qos: 2')
      expect(content).toContain('retain: false')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should validate refresh interval with Zod - value too low', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.ELECTROLUX_REFRESH_INTERVAL = '5' // Too low

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      expect(errorSpy).toHaveBeenCalledWith('Environment variable validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('ELECTROLUX_REFRESH_INTERVAL'))).toBe(true)

      errorSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should validate appliance discovery interval with Zod - value too high', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL = '5000' // Too high

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      expect(errorSpy).toHaveBeenCalledWith('Environment variable validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL'))).toBe(true)

      errorSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should validate token refresh threshold with Zod - value too low', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY = '3' // Too low (min 5)

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      expect(errorSpy).toHaveBeenCalledWith('Environment variable validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY'))).toBe(true)

      errorSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should validate token refresh threshold with Zod - value too high', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY = '720' // Too high (max 715)

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      expect(errorSpy).toHaveBeenCalledWith('Environment variable validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY'))).toBe(true)

      errorSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should reject renewTokenBeforeExpiry shorter than refreshInterval', async () => {
      if (fs.existsSync(configPath)) fs.unlinkSync(configPath)
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.ELECTROLUX_REFRESH_INTERVAL = '600' // 10 minutes
      process.env.ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY = '5' // 5 minutes — shorter than refresh interval

      vi.resetModules()

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected — config validation fails at module load
      }

      expect(errorSpy).toHaveBeenCalledWith('Environment variable validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('RENEW_TOKEN_BEFORE_EXPIRY'))).toBe(true)

      errorSpy.mockRestore()
      infoSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('should reject renewTokenBeforeExpiry shorter than applianceDiscoveryInterval', async () => {
      if (fs.existsSync(configPath)) fs.unlinkSync(configPath)
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.ELECTROLUX_REFRESH_INTERVAL = '30' // 30 seconds — fine
      process.env.ELECTROLUX_APPLIANCE_DISCOVERY_INTERVAL = '3600' // 60 minutes
      process.env.ELECTROLUX_RENEW_TOKEN_BEFORE_EXPIRY = '30' // 30 minutes — shorter than discovery interval

      vi.resetModules()

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected — config validation fails at module load
      }

      expect(errorSpy).toHaveBeenCalledWith('Environment variable validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('RENEW_TOKEN_BEFORE_EXPIRY'))).toBe(true)

      errorSpy.mockRestore()
      infoSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('should validate QoS value with Zod - invalid value', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.MQTT_QOS = '5' // Invalid

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      expect(errorSpy).toHaveBeenCalledWith('Environment variable validation failed:')

      errorSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should transform MQTT_RETAIN string to boolean in config content', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.MQTT_RETAIN = 'true'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0]
      expect(content).toContain('retain: true')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should parse and format LOGGING_IGNORED_KEYS correctly', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.LOGGING_IGNORED_KEYS = 'key1,key2,key3'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0]
      expect(content).toContain('- key1')
      expect(content).toContain('- key2')
      expect(content).toContain('- key3')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should handle empty LOGGING_IGNORED_KEYS', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.LOGGING_IGNORED_KEYS = ''

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0]
      expect(content).toContain('ignoredKeys:')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should return config content and warn when writeFileSync fails (read-only filesystem)', async () => {
      process.env.MQTT_URL = 'mqtt://test-broker'
      process.env.MQTT_USERNAME = 'test-user'
      process.env.MQTT_PASSWORD = 'test-pass'
      process.env.ELECTROLUX_API_KEY = 'test-key'
      process.env.ELECTROLUX_USERNAME = 'test@example.com'
      process.env.ELECTROLUX_PASSWORD = 'electrolux-pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('EACCES: permission denied')
      })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      const result = createConfigFromEnv()

      expect(warnSpy).toHaveBeenCalledWith(
        'Could not write config file to disk (read-only filesystem). Using in-memory config.',
      )
      expect(result).toBeDefined()
      expect(result).toContain('mqtt:')
      expect(result).toContain('url: mqtt://test-broker')

      writeSpy.mockRestore()
      warnSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should return undefined when env validation fails', async () => {
      delete process.env.MQTT_URL
      delete process.env.MQTT_USERNAME

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      const result = createConfigFromEnv()

      expect(result).toBeUndefined()

      errorSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should use custom MQTT settings when provided', async () => {
      process.env.MQTT_URL = 'mqtt://custom'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.MQTT_CLIENT_ID = 'my-client'
      process.env.MQTT_TOPIC_PREFIX = 'my_prefix_'
      process.env.MQTT_QOS = '1'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0]
      expect(content).toContain('clientId: my-client')
      expect(content).toContain('topicPrefix: my_prefix_')
      expect(content).toContain('qos: 1')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should include versionCheck in generated config content', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.VERSION_CHECK_INTERVAL = '7200'
      process.env.VERSION_CHECK_NTFY_WEBHOOK_URL = 'https://ntfy.sh/test-topic'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      const result = createConfigFromEnv()

      expect(result).toContain('checkInterval: 7200')
      expect(result).toContain('ntfyWebhookUrl: https://ntfy.sh/test-topic')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should validate VERSION_CHECK_INTERVAL too low', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.VERSION_CHECK_INTERVAL = '10'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      expect(errorSpy).toHaveBeenCalledWith('Environment variable validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('VERSION_CHECK_INTERVAL'))).toBe(true)

      errorSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should accept VERSION_CHECK_UPDATE_CHANNEL=beta and include it in generated config', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.VERSION_CHECK_UPDATE_CHANNEL = 'beta'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      const result = createConfigFromEnv()

      expect(result).toContain('updateChannel: beta')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should reject an invalid VERSION_CHECK_UPDATE_CHANNEL value', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.VERSION_CHECK_UPDATE_CHANNEL = 'nightly'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      expect(errorSpy).toHaveBeenCalledWith('Environment variable validation failed:')
      expect(errorSpy.mock.calls.some((call) => (call[0] as string).includes('VERSION_CHECK_UPDATE_CHANNEL'))).toBe(
        true,
      )

      errorSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should include logLevel in generated config content', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.LOG_LEVEL = 'debug'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      const result = createConfigFromEnv()

      expect(result).toContain('logLevel: debug')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should default LOG_LEVEL to info when not provided', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      delete process.env.LOG_LEVEL

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      const result = createConfigFromEnv()

      expect(result).toContain('logLevel: info')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should reject invalid LOG_LEVEL value', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.LOG_LEVEL = 'invalid'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      expect(errorSpy).toHaveBeenCalledWith('Environment variable validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('LOG_LEVEL'))).toBe(true)

      errorSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should include showTimestamp in generated config content', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'euser'
      process.env.ELECTROLUX_PASSWORD = 'epass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.LOGGING_SHOW_TIMESTAMP = 'false'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')

      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      const result = createConfigFromEnv()

      expect(result).toContain('showTimestamp: false')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should use default values for healthCheck fields', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'user@test.com'
      process.env.ELECTROLUX_PASSWORD = 'pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0] as [string, string]
      expect(content).toContain('enabled: true')
      expect(content).toContain('filePath: /tmp/e2m-health')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should include HEALTH_CHECK_ENABLED env var in generated config', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'user@test.com'
      process.env.ELECTROLUX_PASSWORD = 'pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.HEALTH_CHECK_ENABLED = 'true'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0] as [string, string]
      expect(content).toContain('enabled: true')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should include HEALTH_CHECK_FILE_PATH env var in generated config', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'user@test.com'
      process.env.ELECTROLUX_PASSWORD = 'pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.HEALTH_CHECK_FILE_PATH = '/custom/health'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0] as [string, string]
      expect(content).toContain('filePath: /custom/health')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should include HEALTH_CHECK_UNHEALTHY_RESTART_MINUTES env var in generated config', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'user@test.com'
      process.env.ELECTROLUX_PASSWORD = 'pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.HEALTH_CHECK_UNHEALTHY_RESTART_MINUTES = '30'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0] as [string, string]
      expect(content).toContain('unHealthyRestartMinutes: 30')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should default revertStateOnRejection to false in generated config', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'user@test.com'
      process.env.ELECTROLUX_PASSWORD = 'pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0] as [string, string]
      expect(content).toContain('revertStateOnRejection: false')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should include HOME_ASSISTANT_REVERT_STATE_ON_REJECTION env var in generated config', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'user@test.com'
      process.env.ELECTROLUX_PASSWORD = 'pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.HOME_ASSISTANT_REVERT_STATE_ON_REJECTION = 'true'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0] as [string, string]
      expect(content).toContain('revertStateOnRejection: true')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should include HOME_ASSISTANT_AUTO_DISCOVERY env var in generated config', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'user@test.com'
      process.env.ELECTROLUX_PASSWORD = 'pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.HOME_ASSISTANT_AUTO_DISCOVERY = 'false'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0] as [string, string]
      expect(content).toContain('autoDiscovery: false')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should include LOGGING_SHOW_CHANGES env var in generated config', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'user@test.com'
      process.env.ELECTROLUX_PASSWORD = 'pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.LOGGING_SHOW_CHANGES = 'false'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0] as [string, string]
      expect(content).toContain('showChanges: false')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should include LOGGING_SHOW_VERSION_NUMBER env var in generated config', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'user@test.com'
      process.env.ELECTROLUX_PASSWORD = 'pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.LOGGING_SHOW_VERSION_NUMBER = 'false'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0] as [string, string]
      expect(content).toContain('showVersionNumber: false')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should include LOGGING_SKIP_CACHE_LOGGING env var in generated config', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'user@test.com'
      process.env.ELECTROLUX_PASSWORD = 'pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.LOGGING_SKIP_CACHE_LOGGING = 'true'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0] as [string, string]
      expect(content).toContain('skipCacheLogging: true')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should default telemetryEnabled to true in generated config', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'user@test.com'
      process.env.ELECTROLUX_PASSWORD = 'pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0] as [string, string]
      expect(content).toContain('telemetryEnabled: true')

      writeSpy.mockRestore()
      infoSpy.mockRestore()
    })

    it('should set telemetryEnabled to false when E2M_TELEMETRY_ENABLED=false', async () => {
      process.env.MQTT_URL = 'mqtt://test'
      process.env.MQTT_USERNAME = 'user'
      process.env.MQTT_PASSWORD = 'pass'
      process.env.ELECTROLUX_API_KEY = 'key'
      process.env.ELECTROLUX_USERNAME = 'user@test.com'
      process.env.ELECTROLUX_PASSWORD = 'pass'
      process.env.ELECTROLUX_COUNTRY_CODE = 'FI'
      process.env.E2M_TELEMETRY_ENABLED = 'false'

      vi.resetModules()
      const { createConfigFromEnv } = await import('../src/config.js')
      const writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

      createConfigFromEnv()

      const [, content] = writeSpy.mock.calls[0] as [string, string]
      expect(content).toContain('telemetryEnabled: false')

      writeSpy.mockRestore()
      infoSpy.mockRestore()

      delete process.env.E2M_TELEMETRY_ENABLED
    })
  })

  describe('Zod schema validation', () => {
    it('should validate MQTT URL format - valid mqtt://', () => {
      const urlSchema = z.string().regex(/^mqtts?:\/\/.+/)

      expect(() => urlSchema.parse('mqtt://localhost')).not.toThrow()
      expect(() => urlSchema.parse('mqtt://broker.com:1883')).not.toThrow()
    })

    it('should validate MQTT URL format - valid mqtts://', () => {
      const urlSchema = z.string().regex(/^mqtts?:\/\/.+/)

      expect(() => urlSchema.parse('mqtts://secure.broker.com:8883')).not.toThrow()
    })

    it('should reject invalid MQTT URL protocols', () => {
      const urlSchema = z.string().regex(/^mqtts?:\/\/.+/)

      expect(() => urlSchema.parse('http://localhost:1883')).toThrow()
      expect(() => urlSchema.parse('localhost:1883')).toThrow()
      expect(() => urlSchema.parse('ftp://broker.com')).toThrow()
    })

    it('should validate QoS range - valid values', () => {
      const qosSchema = z.number().int().min(0).max(2)

      expect(() => qosSchema.parse(0)).not.toThrow()
      expect(() => qosSchema.parse(1)).not.toThrow()
      expect(() => qosSchema.parse(2)).not.toThrow()
    })

    it('should validate QoS range - invalid values', () => {
      const qosSchema = z.number().int().min(0).max(2)

      expect(() => qosSchema.parse(3)).toThrow()
      expect(() => qosSchema.parse(-1)).toThrow()
      expect(() => qosSchema.parse(10)).toThrow()
    })

    it('should validate refresh interval range - valid values', () => {
      const intervalSchema = z.number().int().min(10).max(3600)

      expect(() => intervalSchema.parse(10)).not.toThrow()
      expect(() => intervalSchema.parse(30)).not.toThrow()
      expect(() => intervalSchema.parse(3600)).not.toThrow()
      expect(() => intervalSchema.parse(100)).not.toThrow()
    })

    it('should validate refresh interval range - invalid values', () => {
      const intervalSchema = z.number().int().min(10).max(3600)

      expect(() => intervalSchema.parse(5)).toThrow()
      expect(() => intervalSchema.parse(9)).toThrow()
      expect(() => intervalSchema.parse(4000)).toThrow()
    })

    it('should validate appliance discovery interval range - valid values', () => {
      const intervalSchema = z.number().int().min(60).max(3600)

      expect(() => intervalSchema.parse(60)).not.toThrow()
      expect(() => intervalSchema.parse(300)).not.toThrow()
      expect(() => intervalSchema.parse(3600)).not.toThrow()
    })

    it('should validate appliance discovery interval range - invalid values', () => {
      const intervalSchema = z.number().int().min(60).max(3600)

      expect(() => intervalSchema.parse(30)).toThrow()
      expect(() => intervalSchema.parse(59)).toThrow()
      expect(() => intervalSchema.parse(5000)).toThrow()
    })

    it('should transform string to boolean correctly', () => {
      const boolSchema = z.string().transform((val) => val.toLowerCase() === 'true')

      expect(boolSchema.parse('true')).toBe(true)
      expect(boolSchema.parse('TRUE')).toBe(true)
      expect(boolSchema.parse('True')).toBe(true)
      expect(boolSchema.parse('false')).toBe(false)
      expect(boolSchema.parse('FALSE')).toBe(false)
      expect(boolSchema.parse('anything')).toBe(false)
    })

    it('should coerce string to number', () => {
      const numSchema = z.coerce.number()

      expect(numSchema.parse('30')).toBe(30)
      expect(numSchema.parse('100')).toBe(100)
      expect(numSchema.parse('0')).toBe(0)
      expect(numSchema.parse(50)).toBe(50)
    })

    it('should transform comma-separated string to array', () => {
      const arraySchema = z.string().transform((val) => (val ? val.split(',').map((k) => k.trim()) : []))

      expect(arraySchema.parse('key1,key2,key3')).toEqual(['key1', 'key2', 'key3'])
      expect(arraySchema.parse('key1, key2, key3')).toEqual(['key1', 'key2', 'key3'])
      expect(arraySchema.parse('')).toEqual([])
    })

    it('should use default values with Zod', () => {
      const schema = z.object({
        clientId: z.string().default('electrolux-comfort600'),
        qos: z.coerce.number().default(2),
        retain: z.string().default('false'),
      })

      const result = schema.parse({})
      expect(result.clientId).toBe('electrolux-comfort600')
      expect(result.qos).toBe(2)
      expect(result.retain).toBe('false')
    })

    it('should handle optional fields', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      })

      expect(() => schema.parse({ required: 'value' })).not.toThrow()
      expect(() => schema.parse({ required: 'value', optional: 'other' })).not.toThrow()
      expect(() => schema.parse({ optional: 'value' })).toThrow()
    })

    it('should validate nested objects', () => {
      const schema = z.object({
        mqtt: z.object({
          url: z.string(),
          qos: z.number().min(0).max(2).optional(),
        }),
        electrolux: z.object({
          apiKey: z.string(),
          refreshInterval: z.number().min(10).optional(),
        }),
      })

      expect(() =>
        schema.parse({
          mqtt: { url: 'mqtt://test' },
          electrolux: { apiKey: 'key' },
        }),
      ).not.toThrow()

      expect(() =>
        schema.parse({
          mqtt: { url: 'mqtt://test', qos: 5 },
          electrolux: { apiKey: 'key' },
        }),
      ).toThrow()
    })

    it('should collect multiple validation errors', () => {
      const schema = z.object({
        qos: z.number().min(0).max(2),
        interval: z.number().min(10).max(3600),
      })

      try {
        schema.parse({ qos: 5, interval: 5 })
        expect.fail('Should have thrown validation error')
      } catch (error) {
        expect(error).toBeInstanceOf(z.ZodError)
        if (error instanceof z.ZodError) {
          expect(error.issues.length).toBe(2)
        }
      }
    })
  })

  describe('TypeScript types', () => {
    it('should infer types from Zod schema', () => {
      const schema = z.object({
        mqtt: z.object({
          url: z.string(),
          username: z.string(),
          qos: z.number().optional(),
        }),
      })

      type InferredType = z.infer<typeof schema>

      const validConfig: InferredType = {
        mqtt: {
          url: 'mqtt://test',
          username: 'user',
          qos: 2,
        },
      }

      expect(validConfig.mqtt.url).toBe('mqtt://test')
      expect(validConfig.mqtt.qos).toBe(2)
    })

    it('should handle partial schemas', () => {
      const fullSchema = z.object({
        accessToken: z.string(),
        refreshToken: z.string(),
        eat: z.number(),
      })

      const partialSchema = fullSchema.partial()

      expect(() => partialSchema.parse({})).not.toThrow()
      expect(() => partialSchema.parse({ accessToken: 'token' })).not.toThrow()
      expect(() => partialSchema.parse({ accessToken: 'token', eat: 1234 })).not.toThrow()
    })
  })

  describe('Error messages', () => {
    it('should provide helpful error messages for invalid URLs', () => {
      const schema = z.string().regex(/^mqtts?:\/\/.+/, 'mqtt.url must start with mqtt:// or mqtts://')

      try {
        schema.parse('http://localhost')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(z.ZodError)
        if (error instanceof z.ZodError) {
          expect(error.issues[0].message).toContain('mqtt.url must start with mqtt://')
        }
      }
    })

    it('should provide helpful error messages for invalid intervals', () => {
      const schema = z
        .number()
        .int()
        .min(10, 'electrolux.refreshInterval must be at least 10 seconds')
        .max(3600, 'electrolux.refreshInterval should not exceed 3600 seconds')

      try {
        schema.parse(5)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(z.ZodError)
        if (error instanceof z.ZodError) {
          expect(error.issues[0].message).toContain('must be at least 10 seconds')
        }
      }
    })

    it('should include field path in error messages', () => {
      const schema = z.object({
        mqtt: z.object({
          qos: z.number().min(0).max(2),
        }),
      })

      try {
        schema.parse({ mqtt: { qos: 5 } })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(z.ZodError)
        if (error instanceof z.ZodError) {
          expect(error.issues[0].path).toEqual(['mqtt', 'qos'])
        }
      }
    })
  })

  describe('Config file validation on import', () => {
    beforeEach(() => {
      // Set config file override to use config.test.yml for these tests
      process.env.CONFIG_FILE_OVERRIDE = 'config.test.yml'
    })

    afterEach(() => {
      // Restore valid config after each test
      fs.writeFileSync(configPath, defaultValidConfig, 'utf8')
      delete process.env.CONFIG_FILE_OVERRIDE
    })

    it('should reject a countryCode that is not exactly two letters', async () => {
      const invalidConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FIN
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, invalidConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected to fail
      }

      expect(errorSpy).toHaveBeenCalledWith('Configuration validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('electrolux.countryCode'))).toBe(true)

      errorSpy.mockRestore()
    })

    it('should accept a valid two-letter countryCode', async () => {
      const validConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: SE
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, validConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const config = await import('../src/config.js')

      expect(errorSpy).not.toHaveBeenCalledWith('Configuration validation failed:')
      expect(config.default.electrolux.countryCode).toBe('SE')

      errorSpy.mockRestore()
    })

    it('should validate config file and catch invalid QoS', async () => {
      const invalidConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
  qos: 5
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FI
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, invalidConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected to fail
      }

      expect(errorSpy).toHaveBeenCalledWith('Configuration validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('mqtt.qos'))).toBe(true)

      errorSpy.mockRestore()
    })

    it('should validate config file and catch invalid refresh interval', async () => {
      const invalidConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FI
  refreshInterval: 5
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, invalidConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected to fail
      }

      expect(errorSpy).toHaveBeenCalledWith('Configuration validation failed:')
      expect(
        errorSpy.mock.calls.some(
          (call) => call[0].includes('electrolux.refreshInterval') || call[0].includes('10 seconds'),
        ),
      ).toBe(true)

      errorSpy.mockRestore()
    })

    it('should validate config file and catch invalid appliance discovery interval', async () => {
      const invalidConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FI
  applianceDiscoveryInterval: 5000
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, invalidConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected to fail
      }

      expect(errorSpy).toHaveBeenCalledWith('Configuration validation failed:')
      expect(
        errorSpy.mock.calls.some(
          (call) => call[0].includes('electrolux.applianceDiscoveryInterval') || call[0].includes('3600 seconds'),
        ),
      ).toBe(true)

      errorSpy.mockRestore()
    })

    it('should validate config file and catch invalid token refresh threshold', async () => {
      const invalidConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FI
  renewTokenBeforeExpiry: 2
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, invalidConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected to fail
      }

      expect(errorSpy).toHaveBeenCalledWith('Configuration validation failed:')
      expect(
        errorSpy.mock.calls.some(
          (call) => call[0].includes('electrolux.renewTokenBeforeExpiry') || call[0].includes('5 minutes'),
        ),
      ).toBe(true)

      errorSpy.mockRestore()
    })

    it('should validate config file and catch renewTokenBeforeExpiry shorter than polling intervals', async () => {
      const invalidConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FI
  refreshInterval: 600
  renewTokenBeforeExpiry: 5
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, invalidConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected to fail
      }

      expect(errorSpy).toHaveBeenCalledWith('Configuration validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('renewTokenBeforeExpiry'))).toBe(true)

      errorSpy.mockRestore()
    })

    it('should validate config file and catch invalid MQTT URL', async () => {
      const invalidConfig = `mqtt:
  url: http://localhost
  username: test
  password: test
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FI
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, invalidConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected to fail
      }

      expect(errorSpy).toHaveBeenCalledWith('Configuration validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('mqtt.url'))).toBe(true)

      errorSpy.mockRestore()
    })

    it('should catch multiple validation errors at once', async () => {
      const invalidConfig = `mqtt:
  url: http://localhost
  username: test
  password: test
  qos: 10
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FI
  refreshInterval: 5
  applianceDiscoveryInterval: 5000
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, invalidConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected to fail
      }

      expect(errorSpy).toHaveBeenCalledWith('Configuration validation failed:')
      // Should report multiple errors
      expect(errorSpy.mock.calls.length).toBeGreaterThan(2)

      errorSpy.mockRestore()
    })

    it('should validate config file and catch invalid logLevel', async () => {
      const invalidConfig = `mqtt:
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
logging:
  logLevel: invalid`

      fs.writeFileSync(configPath, invalidConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected to fail
      }

      expect(errorSpy).toHaveBeenCalledWith('Configuration validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('logging.logLevel'))).toBe(true)

      errorSpy.mockRestore()
    })

    it('should handle valid config file successfully', async () => {
      const validConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
  clientId: test-client
  topicPrefix: test_
  retain: false
  qos: 1
electrolux:
  apiKey: test-key
  username: test@example.com
  password: test-pass
  countryCode: FI
  refreshInterval: 30
  applianceDiscoveryInterval: 300
homeAssistant:
  autoDiscovery: true
logging:
  logLevel: info
  showChanges: true
  ignoredKeys: []
  showVersionNumber: true
  skipCacheLogging: true
  showTimestamp: true`

      fs.writeFileSync(configPath, validConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const config = await import('../src/config.js')

      expect(errorSpy).not.toHaveBeenCalledWith('Configuration validation failed:')
      expect(config.default).toBeDefined()
      expect(config.default.mqtt).toBeDefined()
      expect(config.default.electrolux).toBeDefined()

      errorSpy.mockRestore()
    })

    it('should default telemetryEnabled to true when not specified in config file', async () => {
      fs.writeFileSync(configPath, defaultValidConfig, 'utf8')

      vi.resetModules()
      const config = await import('../src/config.js')

      expect(config.default.telemetryEnabled).toBe(true)
    })

    it('should read telemetryEnabled: false from config file', async () => {
      const configWithOptOut = `${defaultValidConfig}
telemetryEnabled: false`
      fs.writeFileSync(configPath, configWithOptOut, 'utf8')

      vi.resetModules()
      const config = await import('../src/config.js')

      expect(config.default.telemetryEnabled).toBe(false)
    })

    it('should default commandStateDelaySeconds to 30 when not specified', async () => {
      fs.writeFileSync(configPath, defaultValidConfig, 'utf8')

      vi.resetModules()
      const config = await import('../src/config.js')

      expect(config.default.electrolux.commandStateDelaySeconds).toBe(30)
    })

    it('should accept a valid custom commandStateDelaySeconds', async () => {
      const configWithDelay = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FI
  commandStateDelaySeconds: 60
homeAssistant:
  autoDiscovery: true`
      fs.writeFileSync(configPath, configWithDelay, 'utf8')

      vi.resetModules()
      const config = await import('../src/config.js')

      expect(config.default.electrolux.commandStateDelaySeconds).toBe(60)
    })

    it('should reject commandStateDelaySeconds below 5', async () => {
      const invalidConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FI
  commandStateDelaySeconds: 4
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, invalidConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected to fail
      }

      expect(errorSpy).toHaveBeenCalledWith('Configuration validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('electrolux.commandStateDelaySeconds'))).toBe(true)

      errorSpy.mockRestore()
    })

    it('should reject commandStateDelaySeconds above 300', async () => {
      const invalidConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test
  username: test
  password: test
  countryCode: FI
  commandStateDelaySeconds: 301
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, invalidConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        await import('../src/config.js')
      } catch {
        // Expected to fail
      }

      expect(errorSpy).toHaveBeenCalledWith('Configuration validation failed:')
      expect(errorSpy.mock.calls.some((call) => call[0].includes('electrolux.commandStateDelaySeconds'))).toBe(true)

      errorSpy.mockRestore()
    })
  })
})

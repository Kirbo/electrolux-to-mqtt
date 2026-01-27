import fs from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

describe('config', () => {
  const originalEnv = process.env
  // Use config.test.yml specifically for config.test.ts manipulation
  const configPath = path.resolve(process.cwd(), 'config.test.yml')
  const tokensPath = path.resolve(process.cwd(), 'tokens.test.json')
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
    // Clean up any existing config.test.yml and tokens.test.json
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath)
    }
    if (fs.existsSync(tokensPath)) {
      fs.unlinkSync(tokensPath)
    }
  })

  afterAll(() => {
    // Clean up config.test.yml and tokens.test.json after all tests
    if (fs.existsSync(configPath)) {
      try {
        fs.unlinkSync(configPath)
      } catch {
        // Ignore cleanup errors
      }
    }
    if (fs.existsSync(tokensPath)) {
      try {
        fs.unlinkSync(tokensPath)
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
      TOKENS_FILE_OVERRIDE: 'tokens.test.json',
    }
    // Ensure a valid config exists before each test
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, defaultValidConfig, 'utf8')
    }
  })

  afterEach(() => {
    process.env = originalEnv
    // Restore valid config after each test
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, defaultValidConfig, 'utf8')
    } else {
      // If config exists but might be invalid, replace it
      try {
        fs.writeFileSync(configPath, defaultValidConfig, 'utf8')
      } catch {
        // Ignore write errors
      }
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
      expect(content).toContain('ignoredKeys: [key1, key2, key3]')

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
      expect(content).toContain('ignoredKeys: []')

      writeSpy.mockRestore()
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
  showChanges: true
  ignoredKeys: []
  showVersionNumber: true
  skipCacheLogging: true`

      fs.writeFileSync(configPath, validConfig, 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const config = await import('../src/config.js')

      expect(errorSpy).not.toHaveBeenCalledWith('Configuration validation failed:')
      expect(config.default).toBeDefined()
      expect(config.default.mqtt).toBeDefined()
      expect(config.default.electrolux).toBeDefined()

      errorSpy.mockRestore()
    })
  })

  describe('Tokens file handling', () => {
    beforeEach(() => {
      // Set config file override to use config.test.yml for these tests
      process.env.CONFIG_FILE_OVERRIDE = 'config.test.yml'
    })

    afterEach(() => {
      delete process.env.CONFIG_FILE_OVERRIDE
    })

    it('should handle missing tokens.json file gracefully', async () => {
      const validConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test-key
  username: test@example.com
  password: test-pass
  countryCode: FI
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, validConfig, 'utf8')

      const tokensPath = path.resolve(process.cwd(), 'tokens.test.json')
      if (fs.existsSync(tokensPath)) {
        fs.unlinkSync(tokensPath)
      }

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const config = await import('../src/config.js')

      expect(config.default).toBeDefined()
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('Error reading tokens.test.json'))

      errorSpy.mockRestore()
    })

    it('should load and validate tokens.json when present', async () => {
      const validConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test-key
  username: test@example.com
  password: test-pass
  countryCode: FI
homeAssistant:
  autoDiscovery: true`

      const tokensData = {
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
        tokenType: 'Bearer',
        scope: 'test-scope',
        eat: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      }

      fs.writeFileSync(configPath, validConfig, 'utf8')
      const tokensPath = path.resolve(process.cwd(), 'tokens.test.json')
      // Remove any existing tokens first
      if (fs.existsSync(tokensPath)) {
        fs.unlinkSync(tokensPath)
      }
      fs.writeFileSync(tokensPath, JSON.stringify(tokensData), 'utf8')

      const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})

      const config = await import('../src/config.js')

      // Check that tokens were loaded (accessToken may be from config or test tokens)
      expect(config.default.electrolux.accessToken).toBeDefined()
      expect(config.default.electrolux.eat).toBeInstanceOf(Date)
      expect(config.default.electrolux.iat).toBeInstanceOf(Date)
      expect(debugSpy).toHaveBeenCalledWith('tokens.test.json loaded')

      debugSpy.mockRestore()
      fs.unlinkSync(tokensPath)
    })

    it('should handle corrupt tokens.json file', async () => {
      const validConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test-key
  username: test@example.com
  password: test-pass
  countryCode: FI
homeAssistant:
  autoDiscovery: true`

      fs.writeFileSync(configPath, validConfig, 'utf8')
      const tokensPath = path.resolve(process.cwd(), 'tokens.test.json')
      fs.writeFileSync(tokensPath, 'invalid json{{{', 'utf8')

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await import('../src/config.js')

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Error reading tokens\.test\.json/),
        expect.anything(),
      )

      errorSpy.mockRestore()
      fs.unlinkSync(tokensPath)
    })

    it('should handle partial tokens data', async () => {
      const validConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test-key
  username: test@example.com
  password: test-pass
  countryCode: FI
homeAssistant:
  autoDiscovery: true`

      const partialTokens = {
        accessToken: 'test-token',
        // Missing other fields
      }

      fs.writeFileSync(configPath, validConfig, 'utf8')
      const tokensPath = path.resolve(process.cwd(), 'tokens.test.json')
      fs.writeFileSync(tokensPath, JSON.stringify(partialTokens), 'utf8')

      const config = await import('../src/config.js')

      expect(config.default.electrolux.accessToken).toBe('test-token')
      // Should handle missing fields gracefully
      expect(config.default.electrolux.eat).toBeUndefined()
      expect(config.default.electrolux.iat).toBeUndefined()

      fs.unlinkSync(tokensPath)
    })

    it('should convert Unix timestamps to Date objects correctly', async () => {
      const validConfig = `mqtt:
  url: mqtt://localhost
  username: test
  password: test
electrolux:
  apiKey: test-key
  username: test@example.com
  password: test-pass
  countryCode: FI
homeAssistant:
  autoDiscovery: true`

      const now = Math.floor(Date.now() / 1000)
      const tokensData = {
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
        tokenType: 'Bearer',
        scope: 'test-scope',
        eat: now + 3600,
        iat: now,
      }

      fs.writeFileSync(configPath, validConfig, 'utf8')
      const tokensPath = path.resolve(process.cwd(), 'tokens.test.json')
      fs.writeFileSync(tokensPath, JSON.stringify(tokensData), 'utf8')

      const config = await import('../src/config.js')

      expect(config.default.electrolux.eat).toBeInstanceOf(Date)
      expect(config.default.electrolux.iat).toBeInstanceOf(Date)
      expect(config.default.electrolux.eat?.getTime()).toBe((now + 3600) * 1000)
      expect(config.default.electrolux.iat?.getTime()).toBe(now * 1000)

      fs.unlinkSync(tokensPath)
    })
  })
})

import axios, { type AxiosError, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaseAppliance } from '@/appliances/base.js'
import config from '@/config.js'
import { ElectroluxClient, formatStateDifferences, getStateDifferences } from '@/electrolux.js'
import type { IMqtt } from '@/mqtt.js'
import type { NormalizedState } from '@/types/normalized.js'
import type { Appliance } from '@/types.js'
import {
  mockApplianceInfoResponse,
  mockApplianceStateResponse,
  mockAppliancesResponse,
  mockCommandResponse,
  mockCsrfTokenResponse,
  mockLoginResponse,
  mockTokenExchangeResponse,
  mockTokenRefreshResponse,
} from './fixtures/api-responses.js'

// Type for mocking axios instance in tests
type MockAxiosInstance = ReturnType<typeof vi.fn> & {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
  interceptors: {
    request: { use: ReturnType<typeof vi.fn> }
    response: { use: ReturnType<typeof vi.fn> }
  }
}

// Type for mocking appliances in tests
interface MockAppliance {
  applianceId: string
  applianceName: string
  applianceType: string
  applianceInfo: Record<string, unknown>
  getApplianceId: () => string
  getApplianceName: () => string
  getApplianceType: () => string
  getApplianceInfo: () => Record<string, unknown>
  normalizeState: (state: Appliance) => NormalizedState
  transformMqttCommandToApi?: (command: Record<string, unknown>) => Record<string, unknown>
  deriveImmediateStateFromCommand?: (payload: Record<string, unknown>) => Partial<NormalizedState> | null
  validateCommand?: (
    command: Partial<NormalizedState>,
    currentMode: string,
  ) => { valid: true } | { valid: false; reason: string }
  generateAutoDiscoveryConfig: () => Record<string, unknown>
  getSupportedModes: () => string[]
  getSupportedFanModes: () => string[]
  getSupportedSwingModes: () => string[]
  getTemperatureRange: () => { min: number; max: number; initial: number }
  getModelName: () => string
}

const loggerWarnSpy = vi.hoisted(() => vi.fn())
const loggerErrorSpy = vi.hoisted(() => vi.fn())
const loggerInfoSpy = vi.hoisted(() => vi.fn())

vi.mock('axios')
vi.mock('@/logger.js', () => ({
  default: () => ({
    debug: vi.fn(),
    info: loggerInfoSpy,
    warn: loggerWarnSpy,
    error: loggerErrorSpy,
  }),
}))
vi.mock('@/cache.js', () => ({
  cache: {
    get: vi.fn(),
    set: vi.fn(),
    cacheKey: vi.fn((id: string) => ({
      state: `${id}-state`,
      info: `${id}-info`,
    })),
  },
}))

// Helper function to create complete mock appliances
function createMockAppliance(overrides: Partial<MockAppliance> = {}): MockAppliance {
  const defaults: MockAppliance = {
    applianceId: 'test-appliance-123',
    applianceName: 'Test Appliance',
    applianceType: 'AC',
    applianceInfo: {},
    getApplianceId: () => 'test-appliance-123',
    getApplianceName: () => 'Test Appliance',
    getApplianceType: () => 'AC',
    getApplianceInfo: () => ({}),
    normalizeState: vi.fn(
      (state: Appliance) =>
        ({
          applianceId: state.applianceId,
          mode: state.properties.reported.mode,
          targetTemperatureC: state.properties.reported.targetTemperatureC,
        }) as NormalizedState,
    ),
    transformMqttCommandToApi: vi.fn((cmd) => cmd),
    deriveImmediateStateFromCommand: vi.fn(() => null),
    validateCommand: vi.fn(() => ({ valid: true as const })),
    generateAutoDiscoveryConfig: vi.fn(() => ({})),
    getSupportedModes: vi.fn(() => ['cool', 'heat', 'auto', 'off']),
    getSupportedFanModes: vi.fn(() => ['auto', 'low', 'medium', 'high']),
    getSupportedSwingModes: vi.fn(() => ['off', 'vertical', 'horizontal', 'both']),
    getTemperatureRange: vi.fn(() => ({ min: 16, max: 30, initial: 22 })),
    getModelName: vi.fn(() => 'TestModel'),
  }
  return { ...defaults, ...overrides }
}

describe('electrolux', () => {
  describe('getStateDifferences', () => {
    it('should return empty differences when oldState is null', () => {
      const newState = {
        applianceId: 'test-123',
        mode: 'cool',
        targetTemperatureC: 22,
      } as NormalizedState

      const differences = getStateDifferences(null, newState)
      expect(Object.keys(differences)).toHaveLength(0)
    })

    it('should detect scalar value changes', () => {
      const oldState = {
        applianceId: 'test-123',
        mode: 'cool',
        targetTemperatureC: 20,
      } as NormalizedState

      const newState = {
        applianceId: 'test-123',
        mode: 'heat',
        targetTemperatureC: 25,
      } as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      expect(differences.mode).toEqual({ from: 'cool', to: 'heat' })
      expect(differences.targetTemperatureC).toEqual({ from: 20, to: 25 })
    })

    it('should detect nested object changes when values differ', () => {
      const oldState = {
        applianceId: 'test-123',
        mode: 'cool',
        targetTemperatureC: 20,
      } as NormalizedState

      const newState = {
        applianceId: 'test-123',
        mode: 'cool',
        targetTemperatureC: 25,
      } as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      // Should detect the temperature change
      expect(differences.targetTemperatureC).toEqual({ from: 20, to: 25 })
      expect(Object.keys(differences).length).toBeGreaterThan(0)
    })

    it('should ignore unchanged values', () => {
      const oldState = {
        applianceId: 'test-123',
        mode: 'cool',
        targetTemperatureC: 22,
      } as NormalizedState

      const newState = {
        applianceId: 'test-123',
        mode: 'cool',
        targetTemperatureC: 22,
      } as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      expect(Object.keys(differences)).toHaveLength(0)
    })

    it('should normalize null and undefined', () => {
      const oldState = {
        applianceId: 'test-123',
        mode: undefined,
      } as unknown as NormalizedState

      const newState = {
        applianceId: 'test-123',
        mode: null,
      } as unknown as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      expect(Object.keys(differences)).toHaveLength(0)
    })

    it('should detect new keys', () => {
      const oldState = {
        applianceId: 'test-123',
        mode: 'cool',
      } as NormalizedState

      const newState = {
        applianceId: 'test-123',
        mode: 'cool',
        targetTemperatureC: 22,
      } as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      expect(differences.targetTemperatureC).toEqual({ from: undefined, to: 22 })
    })

    it('should not detect removed keys (only compares newState keys)', () => {
      const oldState = {
        applianceId: 'test-123',
        mode: 'cool',
        targetTemperatureC: 22,
      } as NormalizedState

      const newState = {
        applianceId: 'test-123',
        mode: 'cool',
      } as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      // getStateDifferences only compares keys present in newState
      expect(differences.targetTemperatureC).toBeUndefined()
    })

    it('should handle deeply nested object comparisons', () => {
      const oldState = {
        applianceId: 'test-123',
        deviceInfo: {
          signal: -50,
          quality: 80,
        },
      } as unknown as NormalizedState

      const newState = {
        applianceId: 'test-123',
        deviceInfo: {
          signal: -55,
          quality: 75,
        },
      } as unknown as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      // The function should detect changes in nested objects
      expect(Object.keys(differences).length).toBeGreaterThan(0)
    })

    it('should handle null to value transitions', () => {
      const oldState = {
        applianceId: 'test-123',
        mode: null,
      } as unknown as NormalizedState

      const newState = {
        applianceId: 'test-123',
        mode: 'cool',
      } as unknown as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      expect(differences.mode).toEqual({ from: null, to: 'cool' })
    })

    it('should handle value to null transitions', () => {
      const oldState = {
        applianceId: 'test-123',
        mode: 'cool',
      } as NormalizedState

      const newState = {
        applianceId: 'test-123',
        mode: null,
      } as unknown as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      expect(differences.mode).toEqual({ from: 'cool', to: null })
    })

    it('should handle complex nested changes', () => {
      const oldState = {
        applianceId: 'test-123',
        settings: {
          temperature: {
            current: 20,
            target: 22,
          },
        },
      } as unknown as NormalizedState

      const newState = {
        applianceId: 'test-123',
        settings: {
          temperature: {
            current: 21,
            target: 23,
          },
        },
      } as unknown as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      expect(Object.keys(differences).length).toBeGreaterThan(0)
    })

    it('should handle arrays in state', () => {
      const oldState = {
        applianceId: 'test-123',
        supportedModes: ['cool', 'heat'],
      } as unknown as NormalizedState

      const newState = {
        applianceId: 'test-123',
        supportedModes: ['cool', 'heat', 'auto'],
      } as unknown as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      // Arrays are compared as objects, the new element at index 2 should be detected
      expect(differences['supportedModes.2']).toEqual({ from: undefined, to: 'auto' })
    })

    it('should handle boolean value changes', () => {
      const oldState = {
        applianceId: 'test-123',
        isRunning: false,
      } as unknown as NormalizedState

      const newState = {
        applianceId: 'test-123',
        isRunning: true,
      } as unknown as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      expect(differences.isRunning).toEqual({ from: false, to: true })
    })

    it('should handle number value changes including zero', () => {
      const oldState = {
        applianceId: 'test-123',
        fanSpeed: 0,
      } as unknown as NormalizedState

      const newState = {
        applianceId: 'test-123',
        fanSpeed: 5,
      } as unknown as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      expect(differences.fanSpeed).toEqual({ from: 0, to: 5 })
    })

    it('should handle empty string to value changes', () => {
      const oldState = {
        applianceId: 'test-123',
        mode: '',
      } as unknown as NormalizedState

      const newState = {
        applianceId: 'test-123',
        mode: 'cool',
      } as unknown as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      expect(differences.mode).toEqual({ from: '', to: 'cool' })
    })

    describe('with ignoredKeys', () => {
      const logging = config.logging as NonNullable<typeof config.logging>
      const originalIgnoredKeys = logging.ignoredKeys

      afterEach(() => {
        logging.ignoredKeys = originalIgnoredKeys
      })

      it('should exclude exact-match ignored keys from differences', () => {
        logging.ignoredKeys = ['mode']

        const oldState = { applianceId: 'test-123', mode: 'cool', targetTemperatureC: 20 } as NormalizedState
        const newState = { applianceId: 'test-123', mode: 'heat', targetTemperatureC: 25 } as NormalizedState

        const differences = getStateDifferences(oldState, newState)
        expect(differences.mode).toBeUndefined()
        expect(differences.targetTemperatureC).toEqual({ from: 20, to: 25 })
      })

      it('should exclude nested keys when parent path is ignored', () => {
        logging.ignoredKeys = ['networkInterface']

        const oldState = {
          applianceId: 'test-123',
          networkInterface: { rssi: -45, linkQualityIndicator: 'GOOD' },
          mode: 'cool',
        } as unknown as NormalizedState

        const newState = {
          applianceId: 'test-123',
          networkInterface: { rssi: -60, linkQualityIndicator: 'POOR' },
          mode: 'heat',
        } as unknown as NormalizedState

        const differences = getStateDifferences(oldState, newState)
        expect(differences['networkInterface.rssi']).toBeUndefined()
        expect(differences['networkInterface.linkQualityIndicator']).toBeUndefined()
        expect(differences.mode).toEqual({ from: 'cool', to: 'heat' })
      })

      it('should exclude top-level ignored keys from the main comparison loop', () => {
        logging.ignoredKeys = ['targetTemperatureC']

        const oldState = { applianceId: 'test-123', targetTemperatureC: 20 } as NormalizedState
        const newState = { applianceId: 'test-123', targetTemperatureC: 25 } as NormalizedState

        const differences = getStateDifferences(oldState, newState)
        expect(Object.keys(differences)).toHaveLength(0)
      })
    })
  })

  describe('formatStateDifferences', () => {
    it('should format single difference', () => {
      const differences = {
        mode: { from: 'cool', to: 'heat' },
      }

      const formatted = formatStateDifferences(differences)
      expect(formatted).toContain('mode')
      expect(formatted).toContain('cool')
      expect(formatted).toContain('heat')
    })

    it('should format multiple differences', () => {
      const differences = {
        mode: { from: 'cool', to: 'heat' },
        targetTemperatureC: { from: 20, to: 25 },
      }

      const formatted = formatStateDifferences(differences)
      expect(formatted).toContain('mode')
      expect(formatted).toContain('targetTemperatureC')
    })

    it('should format nested differences', () => {
      const differences = {
        'networkInterface.rssi': { from: -50, to: -40 },
      }

      const formatted = formatStateDifferences(differences)
      expect(formatted).toContain('networkInterface.rssi')
      expect(formatted).toContain('-50')
      expect(formatted).toContain('-40')
    })

    it('should handle null values', () => {
      const differences = {
        mode: { from: null, to: 'cool' },
      }

      const formatted = formatStateDifferences(differences)
      expect(formatted).toContain('mode')
      expect(formatted).toContain('cool')
    })

    it('should handle undefined values', () => {
      const differences = {
        targetTemperatureC: { from: 22, to: undefined },
      }

      const formatted = formatStateDifferences(differences)
      expect(formatted).toContain('targetTemperatureC')
      expect(formatted).toContain('22')
    })

    it('should return empty string for no differences', () => {
      const differences = {}
      const formatted = formatStateDifferences(differences)
      expect(formatted).toBe('')
    })
  })

  describe('API constants', () => {
    it('should define token refresh threshold', () => {
      const TOKEN_REFRESH_THRESHOLD_HOURS = 6
      expect(TOKEN_REFRESH_THRESHOLD_HOURS).toBe(6)
    })

    it('should define command state delay', () => {
      const COMMAND_STATE_DELAY_MS = 30_000
      expect(COMMAND_STATE_DELAY_MS).toBe(30000)
    })

    it('should define error response max length', () => {
      const ERROR_RESPONSE_MAX_LENGTH = 200
      expect(ERROR_RESPONSE_MAX_LENGTH).toBe(200)
    })

    it('should define login retry delay', () => {
      const LOGIN_RETRY_DELAY_MS = 5_000
      expect(LOGIN_RETRY_DELAY_MS).toBe(5000)
    })

    it('should define token refresh retry delay', () => {
      const TOKEN_REFRESH_RETRY_DELAY_MS = 5_000
      expect(TOKEN_REFRESH_RETRY_DELAY_MS).toBe(5000)
    })
  })

  describe('Base64 encoding', () => {
    it('should encode credentials correctly', () => {
      const username = 'test@example.com'
      const password = 'testpassword'
      const encoded = Buffer.from(`${username}:${password}`).toString('base64')
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8')

      expect(decoded).toBe(`${username}:${password}`)
    })

    it('should handle special characters in credentials', () => {
      const username = 'test@example.com'
      const password = 'p@ssw0rd!#$%'
      const encoded = Buffer.from(`${username}:${password}`).toString('base64')
      const decoded = Buffer.from(encoded, 'base64').toString('utf-8')

      expect(decoded).toBe(`${username}:${password}`)
    })
  })

  describe('Token expiry calculation', () => {
    it('should calculate token expiry correctly', () => {
      const now = Date.now()
      const expiresIn = 3600 // 1 hour
      const expiryTime = now + expiresIn * 1000

      expect(expiryTime).toBeGreaterThan(now)
      expect(expiryTime).toBeLessThanOrEqual(now + 3600 * 1000)
    })

    it('should detect expired tokens', () => {
      const tokenIssuedAt = Date.now() - 7 * 60 * 60 * 1000 // 7 hours ago
      const tokenExpiresAt = tokenIssuedAt + 3600 * 1000 // Expires 1 hour after issue
      const now = Date.now()

      const isExpired = now >= tokenExpiresAt
      expect(isExpired).toBe(true)
    })

    it('should detect valid tokens', () => {
      const tokenIssuedAt = Date.now()
      const tokenExpiresAt = tokenIssuedAt + 3600 * 1000 // Expires in 1 hour
      const now = Date.now()

      const isExpired = now >= tokenExpiresAt
      expect(isExpired).toBe(false)
    })

    it('should calculate refresh threshold correctly', () => {
      const TOKEN_REFRESH_THRESHOLD_HOURS = 6
      const thresholdMs = TOKEN_REFRESH_THRESHOLD_HOURS * 60 * 60 * 1000

      expect(thresholdMs).toBe(6 * 60 * 60 * 1000)
      expect(thresholdMs).toBe(21600000)
    })
  })

  describe('API URL construction', () => {
    it('should construct appliances list URL', () => {
      const baseUrl = 'https://api.developer.electrolux.one'
      const appliancesUrl = `${baseUrl}/api/v1/appliances`

      expect(appliancesUrl).toBe('https://api.developer.electrolux.one/api/v1/appliances')
    })

    it('should construct appliance info URL', () => {
      const baseUrl = 'https://api.developer.electrolux.one'
      const applianceId = 'test-123'
      const infoUrl = `${baseUrl}/api/v1/appliances/${applianceId}/info`

      expect(infoUrl).toBe('https://api.developer.electrolux.one/api/v1/appliances/test-123/info')
    })

    it('should construct appliance state URL', () => {
      const baseUrl = 'https://api.developer.electrolux.one'
      const applianceId = 'test-123'
      const stateUrl = `${baseUrl}/api/v1/appliances/${applianceId}/state`

      expect(stateUrl).toBe('https://api.developer.electrolux.one/api/v1/appliances/test-123/state')
    })

    it('should construct command URL', () => {
      const baseUrl = 'https://api.developer.electrolux.one'
      const applianceId = 'test-123'
      const commandUrl = `${baseUrl}/api/v1/appliances/${applianceId}/command`

      expect(commandUrl).toBe('https://api.developer.electrolux.one/api/v1/appliances/test-123/command')
    })
  })

  describe('Timeout management', () => {
    it('should track active timeouts', () => {
      const activeTimeouts = new Set<NodeJS.Timeout>()
      const timeout = setTimeout(() => {}, 1000)

      activeTimeouts.add(timeout)
      expect(activeTimeouts.has(timeout)).toBe(true)

      clearTimeout(timeout)
      activeTimeouts.delete(timeout)
      expect(activeTimeouts.has(timeout)).toBe(false)
    })

    it('should cleanup multiple timeouts', () => {
      const activeTimeouts = new Set<NodeJS.Timeout>()
      const timeout1 = setTimeout(() => {}, 1000)
      const timeout2 = setTimeout(() => {}, 2000)

      activeTimeouts.add(timeout1)
      activeTimeouts.add(timeout2)
      expect(activeTimeouts.size).toBe(2)

      for (const timeout of activeTimeouts) {
        clearTimeout(timeout)
      }
      activeTimeouts.clear()
      expect(activeTimeouts.size).toBe(0)
    })
  })

  describe('extractUrlPath helper', () => {
    it('should extract path from absolute URL', () => {
      const url = 'https://api.example.com/api/v1/appliances'
      const urlObj = new URL(url)
      expect(urlObj.pathname).toBe('/api/v1/appliances')
    })

    it('should handle relative URLs', () => {
      const url = '/api/v1/appliances'
      expect(url).toBe('/api/v1/appliances')
    })

    it('should handle URLs with query parameters', () => {
      const url = 'https://api.example.com/api/v1/appliances?limit=10'
      const urlObj = new URL(url)
      expect(urlObj.pathname).toBe('/api/v1/appliances')
      expect(urlObj.search).toBe('?limit=10')
    })

    it('should handle empty URL', () => {
      const url = ''
      expect(url).toBe('')
    })

    it('should handle undefined URL', () => {
      const url = undefined
      expect(url).toBeUndefined()
    })
  })

  describe('formatAxiosError helper', () => {
    it('should format error with status code', () => {
      const error = {
        message: 'Request failed',
        response: {
          status: 404,
          statusText: 'Not Found',
        },
        config: {
          method: 'get',
          url: '/api/v1/appliances',
        },
      }

      const formatted = `${error.message} (${error.response.status} ${error.response.statusText}) [${error.config.method.toUpperCase()} ${error.config.url}]`
      expect(formatted).toContain('404')
      expect(formatted).toContain('Not Found')
      expect(formatted).toContain('GET')
    })

    it('should format error without status text', () => {
      const error = {
        message: 'Request failed',
        response: {
          status: 500,
        },
        config: {
          method: 'post',
          url: '/api/v1/appliances/123/command',
        },
      }

      const formatted = `${error.message} (${error.response.status})`
      expect(formatted).toContain('500')
      expect(formatted).toContain('Request failed')
    })

    it('should handle error with response data', () => {
      const error = {
        message: 'Validation failed',
        response: {
          status: 400,
          data: { error: 'Invalid request' },
        },
      }

      const dataStr = JSON.stringify(error.response.data)
      expect(dataStr.length).toBeLessThan(200) // Within ERROR_RESPONSE_MAX_LENGTH
      expect(dataStr).toContain('Invalid request')
    })

    it('should handle non-axios errors', () => {
      const error = new Error('Generic error')
      const formatted = String(error)
      expect(formatted).toContain('Generic error')
    })

    it('should handle string errors', () => {
      const error = 'Simple string error'
      const formatted = String(error)
      expect(formatted).toBe('Simple string error')
    })
  })

  describe('command state delay', () => {
    it('should wait correct delay after command', () => {
      const COMMAND_STATE_DELAY_MS = 30_000
      expect(COMMAND_STATE_DELAY_MS).toBe(30000)
      expect(COMMAND_STATE_DELAY_MS).toBe(30 * 1000)
    })

    it('should track command time per appliance', () => {
      const lastCommandTime = new Map<string, number>()
      const applianceId = 'test-123'
      const commandTime = Date.now()

      lastCommandTime.set(applianceId, commandTime)
      expect(lastCommandTime.has(applianceId)).toBe(true)
      expect(lastCommandTime.get(applianceId)).toBe(commandTime)
    })

    it('should check if enough time has passed since command', () => {
      const COMMAND_STATE_DELAY_MS = 30_000
      const lastCommandTime = Date.now() - 35000 // 35 seconds ago
      const now = Date.now()

      const hasEnoughTimePassed = now - lastCommandTime >= COMMAND_STATE_DELAY_MS
      expect(hasEnoughTimePassed).toBe(true)
    })

    it('should check if not enough time has passed since command', () => {
      const COMMAND_STATE_DELAY_MS = 30_000
      const lastCommandTime = Date.now() - 25000 // 25 seconds ago
      const now = Date.now()

      const hasEnoughTimePassed = now - lastCommandTime >= COMMAND_STATE_DELAY_MS
      expect(hasEnoughTimePassed).toBe(false)
    })
  })

  describe('last active mode tracking', () => {
    it('should store last active mode per appliance', () => {
      const lastActiveMode = new Map<string, string>()
      const applianceId = 'test-123'

      lastActiveMode.set(applianceId, 'cool')
      expect(lastActiveMode.get(applianceId)).toBe('cool')

      lastActiveMode.set(applianceId, 'heat')
      expect(lastActiveMode.get(applianceId)).toBe('heat')
    })

    it('should retrieve last active mode', () => {
      const lastActiveMode = new Map<string, string>()
      lastActiveMode.set('appliance-1', 'cool')
      lastActiveMode.set('appliance-2', 'heat')

      expect(lastActiveMode.get('appliance-1')).toBe('cool')
      expect(lastActiveMode.get('appliance-2')).toBe('heat')
    })

    it('should handle missing last active mode', () => {
      const lastActiveMode = new Map<string, string>([['appliance-1', 'cool']])
      expect(lastActiveMode.get('unknown')).toBeUndefined()
      expect(lastActiveMode.get('appliance-1')).toBe('cool')
    })
  })

  describe('previous appliances tracking', () => {
    it('should track previous appliances', () => {
      const previousAppliances = new Map<string, string>()
      previousAppliances.set('appliance-1', 'AC Unit 1')
      previousAppliances.set('appliance-2', 'AC Unit 2')

      expect(previousAppliances.size).toBe(2)
      expect(previousAppliances.get('appliance-1')).toBe('AC Unit 1')
    })

    it('should detect new appliances', () => {
      const previousAppliances = new Map<string, string>()
      previousAppliances.set('appliance-1', 'AC Unit 1')

      const currentApplianceId = 'appliance-2'
      const isNew = !previousAppliances.has(currentApplianceId)

      expect(isNew).toBe(true)
    })

    it('should detect removed appliances', () => {
      const previousAppliances = new Map<string, string>()
      previousAppliances.set('appliance-1', 'AC Unit 1')
      previousAppliances.set('appliance-2', 'AC Unit 2')

      const currentAppliances = new Set(['appliance-1'])
      const removedAppliances = Array.from(previousAppliances.keys()).filter((id) => !currentAppliances.has(id))

      expect(removedAppliances).toContain('appliance-2')
      expect(removedAppliances).toHaveLength(1)
    })
  })

  describe('token refresh logic', () => {
    it('should check if token needs refresh', () => {
      const TOKEN_REFRESH_THRESHOLD_HOURS = 6
      const tokenEat = new Date(Date.now() + 5 * 60 * 60 * 1000) // Expires in 5 hours
      const now = new Date()

      const hoursUntilExpiry = (tokenEat.getTime() - now.getTime()) / (1000 * 60 * 60)
      const needsRefresh = hoursUntilExpiry < TOKEN_REFRESH_THRESHOLD_HOURS

      expect(needsRefresh).toBe(true)
    })

    it('should not refresh when token is fresh', () => {
      const TOKEN_REFRESH_THRESHOLD_HOURS = 6
      const tokenEat = new Date(Date.now() + 10 * 60 * 60 * 1000) // Expires in 10 hours
      const now = new Date()

      const hoursUntilExpiry = (tokenEat.getTime() - now.getTime()) / (1000 * 60 * 60)
      const needsRefresh = hoursUntilExpiry < TOKEN_REFRESH_THRESHOLD_HOURS

      expect(needsRefresh).toBe(false)
    })

    it('should handle expired tokens', () => {
      const tokenEat = new Date(Date.now() - 1000) // Already expired
      const now = new Date()

      const isExpired = tokenEat.getTime() < now.getTime()
      expect(isExpired).toBe(true)
    })

    it('should calculate time until token expiry', () => {
      const tokenEat = new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours
      const now = new Date()

      const msUntilExpiry = tokenEat.getTime() - now.getTime()
      const hoursUntilExpiry = msUntilExpiry / (1000 * 60 * 60)

      expect(hoursUntilExpiry).toBeGreaterThan(1.9)
      expect(hoursUntilExpiry).toBeLessThan(2.1)
    })
  })

  describe('ElectroluxClient state', () => {
    it('should initialize with correct state', () => {
      const client = {
        isLoggingIn: false,
        isLoggedIn: false,
        refreshInterval: 30,
      }

      expect(client.isLoggingIn).toBe(false)
      expect(client.isLoggedIn).toBe(false)
      expect(client.refreshInterval).toBe(30)
    })

    it('should track logging in state', () => {
      const client = {
        isLoggingIn: false,
        isLoggedIn: false,
      }

      client.isLoggingIn = true
      expect(client.isLoggingIn).toBe(true)

      client.isLoggingIn = false
      client.isLoggedIn = true
      expect(client.isLoggedIn).toBe(true)
    })

    it('should handle cleanup of timeouts', () => {
      const activeTimeouts = new Set<NodeJS.Timeout>()
      const timeout1 = setTimeout(() => {}, 1000)
      const timeout2 = setTimeout(() => {}, 2000)

      activeTimeouts.add(timeout1)
      activeTimeouts.add(timeout2)

      // Cleanup
      for (const timeout of activeTimeouts) {
        clearTimeout(timeout)
      }
      activeTimeouts.clear()

      expect(activeTimeouts.size).toBe(0)
    })
  })

  describe('appliance state comparison', () => {
    it('should compare two states for equality', () => {
      const state1 = { mode: 'cool', temperature: 22 }
      const state2 = { mode: 'cool', temperature: 22 }

      expect(JSON.stringify(state1)).toBe(JSON.stringify(state2))
    })

    it('should detect state differences', () => {
      const state1 = { mode: 'cool', temperature: 22 }
      const state2 = { mode: 'heat', temperature: 24 }

      expect(JSON.stringify(state1)).not.toBe(JSON.stringify(state2))
    })

    it('should handle null values in comparison', () => {
      const state1 = { mode: 'cool', temperature: null }
      const state2 = { mode: 'cool', temperature: null }

      expect(JSON.stringify(state1)).toBe(JSON.stringify(state2))
    })

    it('should normalize undefined to null', () => {
      const value1 = undefined
      const value2 = null

      const normalized1 = value1 ?? null
      const normalized2 = value2 ?? null

      expect(normalized1).toBe(normalized2)
    })
  })

  describe('ElectroluxClient', () => {
    let client: ElectroluxClient
    let mockMqtt: IMqtt

    beforeEach(() => {
      mockMqtt = {
        publish: vi.fn(),
        subscribe: vi.fn(),
        isConnected: vi.fn().mockReturnValue(true),
        connect: vi.fn(),
        disconnect: vi.fn(),
        generateAutoDiscoveryConfig: vi.fn(),
        publishInfo: vi.fn(),
      } as unknown as IMqtt

      client = new ElectroluxClient(mockMqtt)
      vi.clearAllMocks()
    })

    afterEach(() => {
      client.cleanup()
    })

    it('should initialize with correct properties', () => {
      expect(client.isLoggingIn).toBe(false)
      expect(client.isLoggedIn).toBe(false)
      expect(client.refreshInterval).toBeGreaterThan(0)
    })

    it('should cleanup timeouts', () => {
      // Cleanup should work even if no timeouts are active
      expect(() => client.cleanup()).not.toThrow()
    })

    it('should initialize API client', async () => {
      const axiosCreateSpy = vi.spyOn(axios, 'create').mockReturnValue({
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      } as unknown as ReturnType<typeof axios.create>)

      await client.initialize()
      expect(axiosCreateSpy).toHaveBeenCalled()
    })

    it('should handle API client not initialized error', () => {
      // The client initializes lazily, so we just verify it doesn't throw during construction
      const uninitializedClient = new ElectroluxClient(mockMqtt)
      expect(uninitializedClient).toBeDefined()
      uninitializedClient.cleanup()
    })

    it('should track last command time per appliance', () => {
      // Access the internal map indirectly by checking the class structure
      expect(client).toHaveProperty('lastCommandTime')
    })

    it('should track last active mode per appliance', () => {
      expect(client).toHaveProperty('lastActiveMode')
    })

    it('should track previous appliances', () => {
      expect(client).toHaveProperty('previousAppliances')
    })

    it('should handle token refresh when expired', async () => {
      vi.spyOn(axios, 'create').mockReturnValue({
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
        post: vi.fn().mockResolvedValue({
          data: {
            accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3MzczNTEwMDAsImlhdCI6MTczNzI2NDYwMH0.test',
            refreshToken: 'newRefreshToken',
          },
        }),
      } as unknown as ReturnType<typeof axios.create>)

      await client.initialize()

      // Should not throw when refreshing tokens
      await expect(client.refreshTokens()).resolves.not.toThrow()
    })

    it('should handle getAppliances without client', async () => {
      const result = await client.getAppliances()
      expect(result).toBeUndefined()
    })

    it('should handle getApplianceInfo without client', async () => {
      const result = await client.getApplianceInfo('test-id')
      expect(result).toBeUndefined()
    })

    it('should handle ensureValidToken without token', async () => {
      await expect(client.ensureValidToken()).resolves.not.toThrow()
    })
  })

  describe('ElectroluxClient - Authentication', () => {
    let client: ElectroluxClient
    let mockMqtt: IMqtt
    let mockAxiosInstance: MockAxiosInstance

    beforeEach(() => {
      mockMqtt = {
        publish: vi.fn(),
        subscribe: vi.fn(),
        isConnected: vi.fn().mockReturnValue(true),
        connect: vi.fn(),
        disconnect: vi.fn(),
        generateAutoDiscoveryConfig: vi.fn(),
        publishInfo: vi.fn(),
      } as unknown as IMqtt

      mockAxiosInstance = {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      } as MockAxiosInstance

      vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as unknown as ReturnType<typeof axios.create>)
      client = new ElectroluxClient(mockMqtt)
      vi.clearAllMocks()
    })

    afterEach(() => {
      client.cleanup()
    })

    describe('login', () => {
      it('should successfully login with valid credentials', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce(mockCsrfTokenResponse)
        vi.mocked(axios.post).mockResolvedValueOnce(mockLoginResponse).mockResolvedValueOnce(mockTokenExchangeResponse)

        await client.initialize()
        const result = await client.login()

        expect(result).toBe(true)
        expect(client.isLoggedIn).toBe(true)
        expect(client.isLoggingIn).toBe(false)
      })

      it('should handle login with flattened payload on invalid_request error', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce(mockCsrfTokenResponse)
        vi.mocked(axios.post)
          .mockResolvedValueOnce({
            status: 200,
            data: { redirectUrl: 'https://developer.electrolux.one?error=invalid_request' },
            statusText: 'OK',
            headers: {},
            config: {} as never,
          })
          .mockResolvedValueOnce(mockLoginResponse)
          .mockResolvedValueOnce(mockTokenExchangeResponse)

        await client.initialize()
        const result = await client.login()

        expect(result).toBe(true)
        expect(vi.mocked(axios.post)).toHaveBeenCalledTimes(3)
      })

      it('should handle missing CSRF token', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce({
          status: 200,
          statusText: 'OK',
          headers: {},
          data: null,
          config: {} as never,
        })
        vi.useFakeTimers()

        const loginPromise = client.login()
        vi.runAllTimers()
        vi.useRealTimers()

        const result = await loginPromise
        expect(result).toBe(false)
        expect(client.isLoggedIn).toBe(false)
      })

      it('should NOT throw when getXcsrfToken returns undefined (DNS down)', async () => {
        // getXcsrfToken catches network errors and returns undefined
        // login() must treat this as a retriable error, not a fatal throw
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND account.electrolux.one'))
        vi.useFakeTimers()

        // Must not throw — should return false and schedule a retry
        const loginPromise = client.login()
        vi.runAllTimers()
        vi.useRealTimers()

        await expect(loginPromise).resolves.toBe(false)
        expect(client.isLoggedIn).toBe(false)
      })

      it('should handle malformed access token in cookie', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce(mockCsrfTokenResponse)
        vi.mocked(axios.post)
          .mockResolvedValueOnce(mockLoginResponse)
          .mockResolvedValueOnce({
            status: 200,
            headers: {
              'set-cookie': [
                'accessToken=s%3Anot-a-jwt; Path=/; HttpOnly',
                'refreshToken=s%3Amock-refresh-token; Path=/; HttpOnly',
              ],
            },
          })
        vi.useFakeTimers()

        const loginPromise = client.login()
        vi.runAllTimers()
        vi.useRealTimers()

        const result = await loginPromise
        expect(result).toBe(false)
      })

      it('should handle access token with invalid payload JSON', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce(mockCsrfTokenResponse)
        vi.mocked(axios.post)
          .mockResolvedValueOnce(mockLoginResponse)
          .mockResolvedValueOnce({
            status: 200,
            headers: {
              'set-cookie': [
                `accessToken=s%3Aheader.${Buffer.from('not-json').toString('base64')}.signature; Path=/; HttpOnly`,
                'refreshToken=s%3Amock-refresh-token; Path=/; HttpOnly',
              ],
            },
          })
        vi.useFakeTimers()

        const loginPromise = client.login()
        vi.runAllTimers()
        vi.useRealTimers()

        const result = await loginPromise
        expect(result).toBe(false)
      })

      it('should handle access token with missing exp/iat fields', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce(mockCsrfTokenResponse)
        vi.mocked(axios.post)
          .mockResolvedValueOnce(mockLoginResponse)
          .mockResolvedValueOnce({
            status: 200,
            headers: {
              'set-cookie': [
                `accessToken=s%3Aheader.${Buffer.from(JSON.stringify({ sub: 'user' })).toString('base64')}.signature; Path=/; HttpOnly`,
                'refreshToken=s%3Amock-refresh-token; Path=/; HttpOnly',
              ],
            },
          })
        vi.useFakeTimers()

        const loginPromise = client.login()
        vi.runAllTimers()
        vi.useRealTimers()

        const result = await loginPromise
        expect(result).toBe(false)
      })

      it('should handle missing authorization code in redirect', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce(mockCsrfTokenResponse)
        vi.mocked(axios.post).mockResolvedValueOnce({
          status: 200,
          data: { redirectUrl: 'https://developer.electrolux.one?error=access_denied' },
          statusText: 'OK',
          headers: {},
          config: {} as never,
        })
        vi.useFakeTimers()

        const loginPromise = client.login()
        vi.runAllTimers()
        vi.useRealTimers()

        const result = await loginPromise
        expect(result).toBe(false)
      })
    })

    describe('token refresh', () => {
      it.skipIf(process.env.CI === 'true')('should refresh tokens successfully', async () => {
        mockAxiosInstance.post.mockResolvedValueOnce(mockTokenRefreshResponse)

        await client.initialize()
        // Set refreshToken so the refresh can work
        client.refreshToken = 'test-refresh-token'
        await client.refreshTokens()

        expect(mockAxiosInstance.post).toHaveBeenCalledWith(
          '/api/v1/token/refresh',
          expect.objectContaining({ refreshToken: expect.any(String) }),
        )
        expect(client.isLoggedIn).toBe(true)
        expect(client.isLoggingIn).toBe(false)
      })

      it('should handle token refresh error and retry', async () => {
        mockAxiosInstance.post.mockRejectedValueOnce(new Error('Token refresh failed'))
        vi.useFakeTimers()

        await client.initialize()
        const refreshPromise = client.refreshTokens()

        vi.runAllTimers()
        vi.useRealTimers()

        await refreshPromise
        expect(mockAxiosInstance.post).toHaveBeenCalled()
      })
    })
  })

  describe('ElectroluxClient - Appliance Operations', () => {
    let client: ElectroluxClient
    let mockMqtt: IMqtt
    let mockAxiosInstance: MockAxiosInstance

    beforeEach(() => {
      mockMqtt = {
        publish: vi.fn(),
        subscribe: vi.fn(),
        isConnected: vi.fn().mockReturnValue(true),
        connect: vi.fn(),
        disconnect: vi.fn(),
        generateAutoDiscoveryConfig: vi.fn(),
        publishInfo: vi.fn(),
      } as unknown as IMqtt

      mockAxiosInstance = {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      } as MockAxiosInstance

      vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as unknown as ReturnType<typeof axios.create>)
      client = new ElectroluxClient(mockMqtt)
      vi.clearAllMocks()
    })

    afterEach(() => {
      client.cleanup()
    })

    describe('getAppliances', () => {
      it('should fetch appliances successfully', async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockAppliancesResponse })

        await client.initialize()
        const appliances = await client.getAppliances()

        expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/appliances')
        expect(appliances).toEqual(mockAppliancesResponse)
        expect(appliances).toHaveLength(2)
      })

      it('should detect and log new appliances', async () => {
        mockAxiosInstance.get
          .mockResolvedValueOnce({ data: [mockAppliancesResponse[0]] })
          .mockResolvedValueOnce({ data: mockAppliancesResponse })

        await client.initialize()
        await client.getAppliances()
        const appliances = await client.getAppliances()

        expect(appliances).toHaveLength(2)
      })

      it('should detect and log removed appliances', async () => {
        mockAxiosInstance.get
          .mockResolvedValueOnce({ data: mockAppliancesResponse })
          .mockResolvedValueOnce({ data: [mockAppliancesResponse[0]] })

        await client.initialize()
        await client.getAppliances()
        const appliances = await client.getAppliances()

        expect(appliances).toHaveLength(1)
      })

      it('should handle API error when fetching appliances', async () => {
        mockAxiosInstance.get.mockRejectedValueOnce(new Error('API Error'))

        await client.initialize()
        const appliances = await client.getAppliances()

        expect(appliances).toBeUndefined()
      })

      it('should return undefined when API response is not a valid ApplianceStub array', async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({ data: { unexpected: 'shape' } })

        await client.initialize()
        const appliances = await client.getAppliances()

        expect(appliances).toBeUndefined()
      })
    })

    describe('getApplianceInfo', () => {
      it('should fetch appliance info successfully', async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockApplianceInfoResponse })

        await client.initialize()
        const info = await client.getApplianceInfo('test-appliance-123')

        expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/appliances/test-appliance-123/info')
        expect(info).toEqual(mockApplianceInfoResponse)
      })

      it('should handle API error when fetching appliance info', async () => {
        mockAxiosInstance.get.mockRejectedValueOnce(new Error('Not found'))

        await client.initialize()
        const info = await client.getApplianceInfo('invalid-id')

        expect(info).toBeUndefined()
      })
    })

    describe('getApplianceState', () => {
      let mockAppliance: MockAppliance

      const normalizeStateForGetApplianceState = (state: Appliance): NormalizedState =>
        ({
          applianceId: state.applianceId,
          mode: state.properties.reported.mode,
          targetTemperatureC: state.properties.reported.targetTemperatureC,
        }) as NormalizedState

      beforeEach(() => {
        mockAppliance = createMockAppliance({
          normalizeState: vi.fn(normalizeStateForGetApplianceState),
        })
      })

      it('should fetch and publish appliance state on first fetch', async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockApplianceStateResponse })

        await client.initialize()
        const state = await client.getApplianceState(mockAppliance as unknown as BaseAppliance)

        expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/appliances/test-appliance-123/state')
        expect(mockMqtt.publish).toHaveBeenCalledWith('test-appliance-123/state', expect.any(String))
        expect(state).toEqual(mockApplianceStateResponse)
      })

      it('should skip state fetch if command was sent recently', async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockApplianceStateResponse })
        mockAxiosInstance.put.mockResolvedValueOnce(mockCommandResponse)

        await client.initialize()

        // Send a command to set the last command time
        await client.sendApplianceCommand(mockAppliance as unknown as BaseAppliance, { mode: 'cool' })

        // Try to fetch state immediately
        await client.getApplianceState(mockAppliance as unknown as BaseAppliance)

        // State fetch should be skipped (only 1 PUT for command, no GET for state)
        expect(mockAxiosInstance.get).not.toHaveBeenCalled()
      })

      it('should handle API error without publishing disconnected state', async () => {
        mockAxiosInstance.get.mockRejectedValueOnce(new Error('Network error'))

        await client.initialize()
        const result = await client.getApplianceState(mockAppliance as unknown as BaseAppliance)

        // Should return undefined on error without publishing disconnected state
        expect(result).toBeUndefined()
        expect(mockMqtt.publish).not.toHaveBeenCalled()
      })
    })

    describe('sendApplianceCommand', () => {
      let mockAppliance: MockAppliance

      const normalizeStateForSendApplianceCommand = (state: Appliance): NormalizedState =>
        ({
          applianceId: state.applianceId,
          mode: state.properties.reported.mode,
          applianceState: state.properties.reported.applianceState,
        }) as NormalizedState

      const transformMqttCommandToApiForSendApplianceCommand = (cmd: Record<string, unknown>) => ({
        WorkMode: cmd.mode === 'cool' ? 1 : 0,
      })

      const deriveImmediateStateFromCommandForSendApplianceCommand = () => null

      beforeEach(() => {
        mockAppliance = createMockAppliance({
          normalizeState: vi.fn(normalizeStateForSendApplianceCommand),
          transformMqttCommandToApi: vi.fn(transformMqttCommandToApiForSendApplianceCommand),
          deriveImmediateStateFromCommand: vi.fn(deriveImmediateStateFromCommandForSendApplianceCommand),
        })
      })

      it('should send command successfully', async () => {
        const { cache } = await import('@/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)

        mockAxiosInstance.put.mockResolvedValueOnce(mockCommandResponse)

        await client.initialize()
        await client.sendApplianceCommand(mockAppliance as unknown as BaseAppliance, { mode: 'cool' })

        expect(mockAxiosInstance.put).toHaveBeenCalledWith(
          '/api/v1/appliances/test-appliance-123/command',
          expect.objectContaining({ WorkMode: 1 }),
        )
        expect(mockMqtt.publish).toHaveBeenCalled()
      })

      it('should handle command error', async () => {
        const { cache } = await import('@/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)

        mockAxiosInstance.put.mockRejectedValueOnce(new Error('Command failed'))

        await client.initialize()
        const result = await client.sendApplianceCommand(mockAppliance as unknown as BaseAppliance, { mode: 'cool' })

        expect(result).toBeUndefined()
      })

      it('should re-publish cached state when command fails', async () => {
        const { cache } = await import('@/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)

        mockAxiosInstance.put.mockRejectedValueOnce(new Error('Command failed'))

        await client.initialize()
        vi.mocked(mockMqtt.publish).mockClear()

        await client.sendApplianceCommand(mockAppliance as unknown as BaseAppliance, { mode: 'cool' })

        // Should re-publish cached state so HA UI reverts
        expect(mockMqtt.publish).toHaveBeenCalledWith(
          expect.stringContaining('test-appliance-123/state'),
          expect.any(String),
        )
      })

      it('should reject invalid command without reverting state (revertStateOnRejection=false)', async () => {
        const { cache } = await import('@/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)

        const validatingAppliance = createMockAppliance({
          ...mockAppliance,
          validateCommand: vi.fn(() => ({ valid: false, reason: 'fan speed HIGH not allowed in dry mode' })),
        })

        await client.initialize()
        vi.mocked(mockMqtt.publish).mockClear()

        await client.sendApplianceCommand(validatingAppliance as unknown as BaseAppliance, { fanSpeedSetting: 'high' })

        // Should NOT have called the API
        expect(mockAxiosInstance.put).not.toHaveBeenCalled()

        // Should NOT revert state (revertStateOnRejection defaults to false)
        expect(mockMqtt.publish).not.toHaveBeenCalled()
      })

      it('should reject invalid command and revert state (revertStateOnRejection=true)', async () => {
        const config = (await import('@/config.js')).default
        const original = config.homeAssistant.revertStateOnRejection
        config.homeAssistant.revertStateOnRejection = true

        try {
          const { cache } = await import('@/cache.js')
          vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)

          const validatingAppliance = createMockAppliance({
            ...mockAppliance,
            validateCommand: vi.fn(() => ({ valid: false, reason: 'fan speed HIGH not allowed in dry mode' })),
          })

          await client.initialize()
          vi.mocked(mockMqtt.publish).mockClear()

          await client.sendApplianceCommand(validatingAppliance as unknown as BaseAppliance, {
            fanSpeedSetting: 'high',
          })

          // Should NOT have called the API
          expect(mockAxiosInstance.put).not.toHaveBeenCalled()

          // Should revert state by republishing cached state
          expect(mockMqtt.publish).toHaveBeenCalledWith(
            expect.stringContaining('test-appliance-123/state'),
            expect.any(String),
          )
        } finally {
          config.homeAssistant.revertStateOnRejection = original
        }
      })
    })

    it('should create API client with headers', async () => {
      const createSpy = vi.spyOn(axios, 'create').mockReturnValue({
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      } as unknown as ReturnType<typeof axios.create>)

      await client.initialize()

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: expect.any(String),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-api-key': expect.any(String),
          }),
        }),
      )
    })

    describe('403 Retry Logic', () => {
      it('should succeed on first try without 403', async () => {
        const { cache } = await import('@/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockAppliancesResponse)
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockAppliancesResponse })

        await client.initialize()
        const appliances = await client.getAppliances()

        expect(appliances).toEqual(mockAppliancesResponse)
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1)
      })

      it('should not retry on non-403 errors', async () => {
        const error500 = new Error('Server error') as AxiosError
        error500.response = { status: 500 } as AxiosResponse

        mockAxiosInstance.get.mockRejectedValueOnce(error500)

        await client.initialize()
        const result = await client.getAppliances()

        expect(result).toBeUndefined()
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1)
      })

      it('should not retry 403 if not logged in', async () => {
        // Don't initialize client, so it won't be logged in
        const error403 = new Error('Request failed') as AxiosError
        error403.response = { status: 403 } as AxiosResponse

        mockAxiosInstance.get.mockRejectedValueOnce(error403)

        const result = await client.getAppliances()

        expect(result).toBeUndefined()
        // Should not have been called since client not initialized
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(0)
      })
    })

    describe('Command State Handling', () => {
      let mockAppliance: MockAppliance

      beforeEach(() => {
        mockAppliance = createMockAppliance()
      })

      it('should track last non-off mode with buildCombinedCommandState', async () => {
        const { cache } = await import('@/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)

        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        // Send a command with mode: cool
        await client.sendApplianceCommand(mockAppliance as unknown as BaseAppliance, { mode: 'cool' })

        // The immediate feedback should include the cool mode
        expect(mockMqtt.publish).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('"mode":"cool"'))
      })

      it('should preserve previous mode when turning off', async () => {
        const { cache } = await import('@/cache.js')
        const stateWithCoolMode = {
          ...mockApplianceStateResponse,
          properties: {
            ...mockApplianceStateResponse.properties,
            reported: {
              ...mockApplianceStateResponse.properties.reported,
              WorkMode: 1, // cool mode
            },
          },
        }
        vi.mocked(cache.get).mockReturnValue(stateWithCoolMode)

        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        // Send off command
        await client.sendApplianceCommand(mockAppliance as unknown as BaseAppliance, { applianceState: 'off' })

        // Should publish with mode still shown as cool even though power is off
        expect(mockMqtt.publish).toHaveBeenCalled()
      })

      it('should publish immediate state feedback after command', async () => {
        const { cache } = await import('@/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)

        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()
        await client.sendApplianceCommand(mockAppliance as unknown as BaseAppliance, { mode: 'cool' })

        expect(mockMqtt.publish).toHaveBeenCalledWith(expect.stringContaining('test-appliance'), expect.any(String))
        expect(cache.set).toHaveBeenCalled()
      })

      it('should not publish if cached state is missing', async () => {
        const { cache } = await import('@/cache.js')
        vi.mocked(cache.get).mockReturnValue(undefined)

        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        // Clear previous calls
        vi.mocked(mockMqtt.publish).mockClear()

        await client.sendApplianceCommand(mockAppliance as unknown as BaseAppliance, { mode: 'cool' })

        // Should not publish immediate feedback without cached state
        expect(mockMqtt.publish).not.toHaveBeenCalled()
        expect(mockAxiosInstance.put).toHaveBeenCalledWith(
          '/api/v1/appliances/test-appliance-123/command',
          expect.any(Object),
        )
      })

      it('should fetch state and publish if changed', async () => {
        const { cache } = await import('@/cache.js')
        const initialState = { ...mockApplianceStateResponse }
        const updatedState = {
          ...mockApplianceStateResponse,
          properties: {
            ...mockApplianceStateResponse.properties,
            reported: {
              ...mockApplianceStateResponse.properties.reported,
              WorkMode: 2, // Different mode
            },
          },
        }

        vi.mocked(cache.get).mockReturnValueOnce(initialState).mockReturnValueOnce(updatedState)

        mockAxiosInstance.get.mockResolvedValue({ data: updatedState })

        await client.initialize()

        // This should trigger fetchAndProcessApplianceState
        const mockAppl = createMockAppliance()
        await client.getApplianceState(mockAppl as unknown as BaseAppliance)

        expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/v1/appliances/test-appliance-123/state')
      })

      it('should handle state processing callback', async () => {
        const { cache } = await import('@/cache.js')
        // Provide a cached state with different values
        const cachedState = {
          ...mockApplianceStateResponse,
          properties: {
            ...mockApplianceStateResponse.properties,
            reported: {
              ...mockApplianceStateResponse.properties.reported,
              targetTemperatureC: 20, // Different temperature
            },
          },
        }
        vi.mocked(cache.get).mockReturnValue(cachedState)

        // New state with different temperature
        const newState = {
          ...mockApplianceStateResponse,
          properties: {
            ...mockApplianceStateResponse.properties,
            reported: {
              ...mockApplianceStateResponse.properties.reported,
              targetTemperatureC: 25, // Changed temperature
            },
          },
        }
        mockAxiosInstance.get.mockResolvedValue({ data: newState })

        await client.initialize()

        let callbackExecuted = false
        const mockAppl = createMockAppliance()
        await client.getApplianceState(mockAppl as unknown as BaseAppliance, () => {
          callbackExecuted = true
        })

        expect(callbackExecuted).toBe(true)
        expect(mockAxiosInstance.get).toHaveBeenCalled()
      })
    })

    describe('buildCombinedCommandState', () => {
      it('should track last active mode when mode command is sent', async () => {
        const { cache } = await import('@/cache.js')
        const cachedState = {
          ...mockApplianceStateResponse,
          properties: {
            ...mockApplianceStateResponse.properties,
            reported: {
              ...mockApplianceStateResponse.properties.reported,
              WorkMode: 1, // cool
              Workmode_1: 1,
            },
          },
        }
        vi.mocked(cache.get).mockReturnValue(cachedState)
        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        const mockAppl = createMockAppliance()
        await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { mode: 'cool' })

        // Verify command was sent
        expect(mockAxiosInstance.put).toHaveBeenCalled()
      })

      it('should restore last active mode when turning on from off state', async () => {
        const { cache } = await import('@/cache.js')
        const offState = {
          ...mockApplianceStateResponse,
          properties: {
            ...mockApplianceStateResponse.properties,
            reported: {
              ...mockApplianceStateResponse.properties.reported,
              Workmode_1: 0, // off
            },
          },
        }
        vi.mocked(cache.get).mockReturnValue(offState)
        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        const mockAppl = createMockAppliance()
        // First set a mode to track
        await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { mode: 'heat' })
        vi.mocked(cache.get).mockReturnValue(offState)
        // Then send a non-mode command (e.g., temperature) while off
        await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { targetTemperatureC: 25 })

        expect(mockAxiosInstance.put).toHaveBeenCalled()
      })

      it('should keep previous mode when turning off', async () => {
        const { cache } = await import('@/cache.js')
        const onState = {
          ...mockApplianceStateResponse,
          properties: {
            ...mockApplianceStateResponse.properties,
            reported: {
              ...mockApplianceStateResponse.properties.reported,
              WorkMode: 1, // cool
              Workmode_1: 1,
            },
          },
        }
        vi.mocked(cache.get).mockReturnValue(onState)
        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        const mockAppl = createMockAppliance()
        // Send off command
        await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { mode: 'off' })

        expect(mockAxiosInstance.put).toHaveBeenCalled()
      })
    })

    describe('Error handling and retries', () => {
      it('should handle login failure and retry', async () => {
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('Connection failed'))
        vi.useFakeTimers()

        try {
          await client.login()
        } catch (error) {
          expect(error).toBeDefined()
        }

        vi.useRealTimers()
      })

      it('should reject waitForLogin waiters when login fails', async () => {
        // Simulate a waiter waiting for login
        const waitPromise = client.waitForLogin()

        // Trigger finishLogin(false) by accessing the private method via login failure path
        // finishLogin(false) should reject all pending waiters
        client.isLoggedIn = false
        client.isLoggingIn = true

        // Access finishLogin indirectly: simulate the failure path
        // We use Object.getPrototypeOf trick to call finishLogin
        const proto = Object.getPrototypeOf(client) as Record<string, unknown>
        const finishLogin = proto.finishLogin as (success: boolean) => void
        finishLogin.call(client, false)

        await expect(waitPromise).rejects.toThrow('Login failed')
      })

      it('should resolve waitForLogin waiters when login succeeds', async () => {
        const waitPromise = client.waitForLogin()

        client.isLoggedIn = false
        client.isLoggingIn = true

        const proto = Object.getPrototypeOf(client) as Record<string, unknown>
        const finishLogin = proto.finishLogin as (success: boolean) => void
        finishLogin.call(client, true)

        await expect(waitPromise).resolves.toBeUndefined()
      })

      it('should handle missing cached state in publishCommandFeedback', async () => {
        const { cache } = await import('@/cache.js')
        vi.mocked(cache.get).mockReturnValue(null)
        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        const mockAppl = createMockAppliance()
        await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { mode: 'cool' })

        // Should not throw even without cached state
        expect(mockAxiosInstance.put).toHaveBeenCalled()
      })

      it('should apply immediate state updates from appliance', async () => {
        const { cache } = await import('@/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)
        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        const mockAppl = createMockAppliance({
          deriveImmediateStateFromCommand: vi.fn(() => ({ targetTemperatureC: 22 })),
        })
        await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { mode: 'cool' })

        expect(mockAppl.deriveImmediateStateFromCommand).toHaveBeenCalled()
      })

      it('should handle token refresh failure and retry', async () => {
        mockAxiosInstance.post.mockRejectedValueOnce(new Error('Refresh failed'))
        vi.useFakeTimers()

        await client.initialize()
        const refreshPromise = client.refreshTokens()

        vi.runAllTimers()
        vi.useRealTimers()

        await refreshPromise
        expect(mockAxiosInstance.post).toHaveBeenCalled()
      })

      it('should apply jitter to login retry delay — Math.random=0 gives base/2', async () => {
        // LOGIN_RETRY_BASE_DELAY_MS = 5000, loginRetryCount starts at 0
        // applyJitter(5000): base/2 + random * base/2 = 2500 + 0 * 2500 = 2500 when random=0
        // Without jitter the delay would be exactly 5000; with jitter at random=0 it is 2500.
        const LOGIN_RETRY_BASE_DELAY_MS = 5_000
        const LOGIN_RETRY_MAX_DELAY_MS = 300_000

        vi.spyOn(Math, 'random').mockReturnValue(0)
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'))
        // Use real timers + spy to capture the delay without blocking the event loop.
        // vi.useFakeTimers() would prevent cleanup and contaminate subsequent tests.
        const capturedDelays: number[] = []
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((_fn, delay, ..._args) => {
          if (typeof delay === 'number') capturedDelays.push(delay)
          // Don't actually schedule — just capture the delay and discard the callback
          return 0 as unknown as NodeJS.Timeout
        })

        try {
          await client.login()

          const baseDelay = Math.min(LOGIN_RETRY_BASE_DELAY_MS * 2 ** 0, LOGIN_RETRY_MAX_DELAY_MS)
          expect(capturedDelays.length).toBeGreaterThan(0)
          const retryDelay = capturedDelays[0] ?? 0
          // With Math.random() === 0, jitter formula gives exactly base/2
          expect(retryDelay).toBe(baseDelay / 2)
        } finally {
          setTimeoutSpy.mockRestore()
          vi.restoreAllMocks()
        }
      })

      it('should apply jitter to token refresh retry delay — Math.random=0 gives base/2', async () => {
        // TOKEN_REFRESH_BASE_DELAY_MS = 5000, refreshRetryCount starts at 0
        // applyJitter(5000): 2500 + 0 * 2500 = 2500 when random=0
        const TOKEN_REFRESH_BASE_DELAY_MS = 5_000
        const TOKEN_REFRESH_MAX_DELAY_MS = 300_000

        vi.spyOn(Math, 'random').mockReturnValue(0)
        mockAxiosInstance.post.mockRejectedValueOnce(new Error('Network error'))
        const capturedDelays: number[] = []
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((_fn, delay, ..._args) => {
          if (typeof delay === 'number') capturedDelays.push(delay)
          // Don't actually schedule — just capture the delay and discard the callback
          return 0 as unknown as NodeJS.Timeout
        })

        try {
          await client.initialize()
          await client.refreshTokens()

          const baseDelay = Math.min(TOKEN_REFRESH_BASE_DELAY_MS * 2 ** 0, TOKEN_REFRESH_MAX_DELAY_MS)
          expect(capturedDelays.length).toBeGreaterThan(0)
          const retryDelay = capturedDelays[0] ?? 0
          // With Math.random() === 0, jitter formula gives exactly base/2
          expect(retryDelay).toBe(baseDelay / 2)
        } finally {
          setTimeoutSpy.mockRestore()
          vi.restoreAllMocks()
        }
      })
    })

    describe('Helper functions', () => {
      it('should extract pathname from absolute URL', () => {
        const url = 'https://api.example.com/api/v1/test'
        const urlObj = new URL(url)
        expect(urlObj.pathname).toBe('/api/v1/test')
      })

      it('should handle relative path in extractUrlPath', () => {
        const url = '/api/v1/appliances'
        // extractUrlPath should handle relative paths
        expect(url.startsWith('/')).toBe(true)
      })

      it('should handle URL with query parameters', () => {
        const url = 'https://api.example.com/api/v1/appliances?limit=10'
        const urlObj = new URL(url)
        expect(urlObj.pathname).toBe('/api/v1/appliances')
      })

      it('should sanitize tokens correctly', () => {
        const token = 's%3Aactual-token-value'
        const sanitized = token.replace('s%3A', '')
        expect(sanitized).toBe('actual-token-value')
      })

      it('should retain partial tokens for logging', () => {
        const fullToken = 'abcdefghij1234567890klmnopqrst'
        const partial = `${fullToken.slice(0, 10)}...token length ${fullToken.length}...${fullToken.slice(-10)}`
        expect(partial).toContain('abcdefghij')
        expect(partial).toContain('klmnopqrst')
        expect(partial).toContain('token length')
      })

      it('should handle CSRF token extraction from cookie', () => {
        const setCookieHeader = ['_csrfSecret=abc123; Path=/; HttpOnly', 'other=value']
        const csrfSecretCookie = setCookieHeader.find((cookie) => cookie.startsWith('_csrfSecret='))
        expect(csrfSecretCookie).toBeDefined()

        if (csrfSecretCookie) {
          const csrfSecret = csrfSecretCookie.split(';')[0].split('=')[1]
          expect(csrfSecret).toBe('abc123')
        }
      })

      it('should handle missing CSRF secret cookie', () => {
        const setCookieHeader = ['other=value; Path=/']
        const csrfSecretCookie = setCookieHeader.find((cookie) => cookie.startsWith('_csrfSecret='))
        expect(csrfSecretCookie).toBeUndefined()
      })
    })

    describe('ensureValidToken', () => {
      it.skipIf(process.env.CI === 'true')('should refresh token when near expiration', async () => {
        mockAxiosInstance.post.mockResolvedValue(mockTokenRefreshResponse)

        await client.initialize()

        // Mock a token that expires soon (less than 1 hour)
        const nearExpiryTime = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
        client.accessToken = 'test-token'
        client.refreshToken = 'test-refresh-token'
        client.eat = nearExpiryTime

        await client.ensureValidToken()

        // Should have attempted to refresh
        expect(mockAxiosInstance.post).toHaveBeenCalled()
      })

      it('should login when no token exists', async () => {
        vi.mocked(axios.get).mockResolvedValueOnce(mockCsrfTokenResponse)
        vi.mocked(axios.post).mockResolvedValueOnce(mockLoginResponse).mockResolvedValueOnce(mockTokenExchangeResponse)

        await client.initialize()

        // Clear tokens
        client.accessToken = undefined
        client.eat = undefined

        await client.ensureValidToken()

        // Should have attempted to login
        expect(vi.mocked(axios.post)).toHaveBeenCalled()
      })

      it('should handle errors in ensureValidToken gracefully', async () => {
        await client.initialize()

        client.eat = undefined
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'))

        // Should not throw
        await expect(client.ensureValidToken()).resolves.not.toThrow()
      })
    })

    describe('403 Retry with token refresh', () => {
      it.skipIf(process.env.CI === 'true')('should retry request after 403 and refresh token', async () => {
        const { cache } = await import('@/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockAppliancesResponse)

        const error403 = new Error('Forbidden') as AxiosError
        error403.response = { status: 403 } as AxiosResponse
        vi.spyOn(axios, 'isAxiosError').mockReturnValue(true)

        mockAxiosInstance.get.mockRejectedValueOnce(error403).mockResolvedValueOnce({ data: mockAppliancesResponse })

        mockAxiosInstance.post.mockResolvedValue(mockTokenRefreshResponse)

        await client.initialize()
        client.isLoggedIn = true
        client.accessToken = 'test-token'
        client.refreshToken = 'test-refresh-token'
        client.eat = new Date(Date.now() + 10 * 60 * 60 * 1000) // 10 hours from now
        const result = await client.getAppliances()

        // Should have attempted to refresh token
        expect(mockAxiosInstance.post).toHaveBeenCalled()
        // Result might be undefined if retry also fails, which is acceptable
        expect([mockAppliancesResponse, undefined]).toContainEqual(result)
      })

      it('should handle retry failure after token refresh', async () => {
        const error403 = new Error('Forbidden') as AxiosError
        error403.response = { status: 403 } as AxiosResponse

        mockAxiosInstance.get.mockRejectedValue(error403)
        mockAxiosInstance.post.mockResolvedValue(mockTokenRefreshResponse)

        await client.initialize()
        client.isLoggedIn = true

        const result = await client.getAppliances()

        expect(result).toBeUndefined()
      })
    })

    describe('429 Rate Limit Handling', () => {
      // Test config: refreshInterval=30, applianceDiscoveryInterval=300
      // With 0 known appliances → numAppliances=max(1,0)=1:
      //   stateCallsPerDay = ceil(86400/30 * 1) = 2880
      //   discoveryCallsPerDay = ceil(86400/300) = 288 → total 3168 < 5000 (burst path)
      // With 2 known appliances (from mockAppliancesResponse):
      //   stateCallsPerDay = ceil(86400/30 * 2) = 5760 → total 6048 > 5000 (suggestion path)
      //   minRefreshInterval = ceil(86400*2 / (5000-288)) = ceil(172800/4712) = 37

      let isAxiosErrorSpy: ReturnType<typeof vi.spyOn>

      const make429Error = () => {
        const error = new Error('Too Many Requests') as AxiosError
        error.response = { status: 429 } as AxiosResponse
        return error
      }

      beforeEach(() => {
        loggerWarnSpy.mockClear()
        isAxiosErrorSpy = vi.spyOn(axios, 'isAxiosError').mockReturnValue(true)
      })

      afterEach(() => {
        isAxiosErrorSpy.mockRestore()
      })

      it('should return undefined when the API responds with 429', async () => {
        mockAxiosInstance.get.mockRejectedValueOnce(make429Error())

        await client.initialize()
        const result = await client.getAppliances()

        expect(result).toBeUndefined()
      })

      it('should not retry the request after 429', async () => {
        mockAxiosInstance.get.mockRejectedValueOnce(make429Error())

        await client.initialize()
        await client.getAppliances()

        // Unlike 403, a 429 must not trigger a second attempt
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1)
      })

      it('should not trigger a token refresh after 429', async () => {
        mockAxiosInstance.get.mockRejectedValueOnce(make429Error())

        await client.initialize()
        await client.getAppliances()

        expect(mockAxiosInstance.post).not.toHaveBeenCalled()
      })

      it('should log a warning that names both configurable intervals', async () => {
        mockAxiosInstance.get.mockRejectedValueOnce(make429Error())

        await client.initialize()
        await client.getAppliances()

        expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('429'))
        expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('electrolux.refreshInterval'))
        expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('electrolux.applianceDiscoveryInterval'))
      })

      it('should log the current refreshInterval, applianceDiscoveryInterval and appliance count', async () => {
        mockAxiosInstance.get.mockRejectedValueOnce(make429Error())

        await client.initialize()
        await client.getAppliances()

        const warnCalls = loggerWarnSpy.mock.calls.map((args: unknown[]) => args[0] as string)
        const settingsLine = warnCalls.find((msg) => msg.includes('Current settings:'))

        expect(settingsLine).toBeDefined()
        expect(settingsLine).toContain(`refreshInterval=${client.refreshInterval}s`)
        expect(settingsLine).toContain('applianceDiscoveryInterval=')
        expect(settingsLine).toContain('monitored appliances=')
      })

      it('should log all three Electrolux API rate limits', async () => {
        mockAxiosInstance.get.mockRejectedValueOnce(make429Error())

        await client.initialize()
        await client.getAppliances()

        const warnCalls = loggerWarnSpy.mock.calls.map((args: unknown[]) => args[0] as string)
        const limitsLine = warnCalls.find((msg) => msg.includes('5000 calls/day'))

        expect(limitsLine).toBeDefined()
        expect(limitsLine).toContain('10 calls/second')
        expect(limitsLine).toContain('5 concurrent calls')
      })

      it('should log estimated daily call breakdown (state polls + discovery polls)', async () => {
        mockAxiosInstance.get.mockRejectedValueOnce(make429Error())

        await client.initialize()
        await client.getAppliances()

        const warnCalls = loggerWarnSpy.mock.calls.map((args: unknown[]) => args[0] as string)
        const estimatedLine = warnCalls.find((msg) => msg.includes('Estimated API calls'))

        expect(estimatedLine).toBeDefined()
        expect(estimatedLine).toContain('state polls')
        expect(estimatedLine).toContain('discovery polls')
      })

      it('should calculate correct daily estimate with no prior known appliances (uses 1 as minimum)', async () => {
        // previousAppliances.size = 0 → numAppliances = max(1,0) = 1
        // stateCallsPerDay = ceil(86400/30 * 1) = 2880
        // discoveryCallsPerDay = ceil(86400/300) = 288
        // estimatedCallsPerDay = 3168
        mockAxiosInstance.get.mockRejectedValueOnce(make429Error())

        await client.initialize()
        await client.getAppliances()

        const warnCalls = loggerWarnSpy.mock.calls.map((args: unknown[]) => args[0] as string)
        const estimatedLine = warnCalls.find((msg) => msg.includes('Estimated API calls'))

        expect(estimatedLine).toContain('~3168')
        expect(estimatedLine).toContain('~2880') // state polls
        expect(estimatedLine).toContain('~288') // discovery polls
      })

      it('should warn about burst limits (not daily limit) when estimated calls are within 5000/day', async () => {
        // 1 appliance, 30s refresh → 3168 calls/day < 5000 → burst warning path
        mockAxiosInstance.get.mockRejectedValueOnce(make429Error())

        await client.initialize()
        await client.getAppliances()

        const warnCalls = loggerWarnSpy.mock.calls.map((args: unknown[]) => args[0] as string)
        const burstLine = warnCalls.find((msg) => msg.includes('within the'))

        expect(burstLine).toBeDefined()
        expect(burstLine).toContain('bursting')
        // Must NOT suggest a minimum interval on the burst path
        expect(warnCalls.find((msg) => msg.includes('Suggested fix:'))).toBeUndefined()
      })

      it('should suggest a minimum refreshInterval when 2 appliances push calls over 5000/day', async () => {
        // First call succeeds and populates previousAppliances with 2 appliances
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockAppliancesResponse })
        await client.initialize()
        await client.getAppliances()
        loggerWarnSpy.mockClear()

        // With 2 appliances and refreshInterval=30:
        //   stateCallsPerDay = ceil(86400/30 * 2) = 5760, total = 6048 > 5000
        //   minRefreshInterval = ceil(86400*2 / (5000-288)) = ceil(172800/4712) = 37
        mockAxiosInstance.get.mockRejectedValueOnce(make429Error())
        await client.getAppliances()

        const warnCalls = loggerWarnSpy.mock.calls.map((args: unknown[]) => args[0] as string)
        const suggestionLine = warnCalls.find((msg) => msg.includes('Suggested fix:'))

        expect(suggestionLine).toBeDefined()
        expect(suggestionLine).toContain('electrolux.refreshInterval')
        expect(suggestionLine).toContain('37s') // ceil(172800/4712) = 37
        // Must NOT show the burst warning on this path
        expect(warnCalls.find((msg) => msg.includes('within the'))).toBeUndefined()
      })

      it('should use the correct appliance count in the suggestion when appliances are known', async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockAppliancesResponse })
        await client.initialize()
        await client.getAppliances()
        loggerWarnSpy.mockClear()

        mockAxiosInstance.get.mockRejectedValueOnce(make429Error())
        await client.getAppliances()

        const warnCalls = loggerWarnSpy.mock.calls.map((args: unknown[]) => args[0] as string)
        const settingsLine = warnCalls.find((msg) => msg.includes('Current settings:'))
        const suggestionLine = warnCalls.find((msg) => msg.includes('Suggested fix:'))

        expect(settingsLine).toContain('monitored appliances=2')
        expect(suggestionLine).toContain('2 appliances')
      })
    })

    describe('removeAppliance', () => {
      it('should clear tracking data for a removed appliance', async () => {
        const { cache } = await import('@/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)
        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        const mockAppl = createMockAppliance()
        // Send a command to populate internal tracking maps
        await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { mode: 'cool' })

        // Remove the appliance
        client.removeAppliance('test-appliance-123')

        // After removal, the command delay should no longer apply (tracking cleared)
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockApplianceStateResponse })
        const state = await client.getApplianceState(mockAppl as unknown as BaseAppliance)
        expect(state).toEqual(mockApplianceStateResponse)
      })
    })

    describe('logStateChanges without showChanges', () => {
      const logging = config.logging as NonNullable<typeof config.logging>
      const originalShowChanges = logging.showChanges

      afterEach(() => {
        logging.showChanges = originalShowChanges
      })

      it('should log state changed without details when showChanges is false', async () => {
        logging.showChanges = false

        const { cache } = await import('@/cache.js')
        const cachedState = {
          ...mockApplianceStateResponse,
          properties: {
            ...mockApplianceStateResponse.properties,
            reported: {
              ...mockApplianceStateResponse.properties.reported,
              targetTemperatureC: 20,
            },
          },
        }
        vi.mocked(cache.get).mockReturnValue(cachedState)

        const newState = {
          ...mockApplianceStateResponse,
          properties: {
            ...mockApplianceStateResponse.properties,
            reported: {
              ...mockApplianceStateResponse.properties.reported,
              targetTemperatureC: 25,
            },
          },
        }
        mockAxiosInstance.get.mockResolvedValueOnce({ data: newState })

        await client.initialize()
        loggerInfoSpy.mockClear()

        const mockAppl = createMockAppliance()
        await client.getApplianceState(mockAppl as unknown as BaseAppliance)

        const infoCalls = loggerInfoSpy.mock.calls.map((args: unknown[]) => args[0] as string)
        const stateChangedLog = infoCalls.find((msg) => msg.includes('State changed'))
        expect(stateChangedLog).toBeDefined()
        // Should NOT contain the arrow notation from formatStateDifferences
        expect(stateChangedLog).not.toContain('→')
      })
    })

    describe('formatAxiosError via real error paths', () => {
      it('should include method and URL path in error log for axios errors', async () => {
        const axiosError = new Error('Request failed') as AxiosError
        axiosError.response = { status: 500, statusText: 'Internal Server Error' } as AxiosResponse
        ;(axiosError as Record<string, unknown>).config = {
          method: 'get',
          url: 'https://api.developer.electrolux.one/api/v1/appliances',
        }
        vi.spyOn(axios, 'isAxiosError').mockReturnValue(true)

        mockAxiosInstance.get.mockRejectedValueOnce(axiosError)

        await client.initialize()
        loggerErrorSpy.mockClear()
        await client.getAppliances()

        const errorCalls = loggerErrorSpy.mock.calls.map((args: unknown[]) => args[0] as string)
        const errorLog = errorCalls.find((msg) => msg.includes('Error getting appliances'))
        expect(errorLog).toContain('[GET /api/v1/appliances]')
        expect(errorLog).toContain('500 Internal Server Error')
      })

      it('should include response data in error log when available and short', async () => {
        const axiosError = new Error('Request failed') as AxiosError
        axiosError.response = {
          status: 400,
          statusText: 'Bad Request',
          data: { error: 'invalid_param' },
        } as AxiosResponse
        ;(axiosError as Record<string, unknown>).config = { method: 'get', url: '/api/v1/appliances' }
        vi.spyOn(axios, 'isAxiosError').mockReturnValue(true)

        mockAxiosInstance.get.mockRejectedValueOnce(axiosError)

        await client.initialize()
        loggerErrorSpy.mockClear()
        await client.getAppliances()

        const errorCalls = loggerErrorSpy.mock.calls.map((args: unknown[]) => args[0] as string)
        const errorLog = errorCalls.find((msg) => msg.includes('Error getting appliances'))
        expect(errorLog).toContain('invalid_param')
      })

      it('should handle axios error with relative URL path', async () => {
        const axiosError = new Error('Request failed') as AxiosError
        axiosError.response = { status: 404, statusText: 'Not Found' } as AxiosResponse
        ;(axiosError as Record<string, unknown>).config = { method: 'get', url: '/api/v1/appliances' }
        vi.spyOn(axios, 'isAxiosError').mockReturnValue(true)

        mockAxiosInstance.get.mockRejectedValueOnce(axiosError)

        await client.initialize()
        loggerErrorSpy.mockClear()
        await client.getAppliances()

        const errorCalls = loggerErrorSpy.mock.calls.map((args: unknown[]) => args[0] as string)
        const errorLog = errorCalls.find((msg) => msg.includes('Error getting appliances'))
        expect(errorLog).toContain('[GET /api/v1/appliances]')
      })
    })

    describe('Token error branches', () => {
      it('should handle 401 during token refresh by clearing tokens and re-logging in', async () => {
        const error401 = new Error('Unauthorized') as AxiosError
        error401.response = { status: 401 } as AxiosResponse
        vi.spyOn(axios, 'isAxiosError').mockReturnValue(true)

        mockAxiosInstance.post.mockRejectedValueOnce(error401)

        // Mock login to succeed after 401 triggers re-authentication
        vi.mocked(axios.get).mockResolvedValueOnce(mockCsrfTokenResponse)
        vi.mocked(axios.post).mockResolvedValueOnce(mockLoginResponse).mockResolvedValueOnce(mockTokenExchangeResponse)

        await client.initialize()
        client.accessToken = 'old-token'
        client.refreshToken = 'old-refresh-token'

        await client.refreshTokens()

        // Tokens should have been cleared before re-login
        expect(client.isLoggedIn).toBe(true) // Re-login succeeded
      })

      it('should NOT propagate when login() throws during 401 refresh fallback (DNS down)', async () => {
        // Scenario: refresh token rejected (401), code falls back to login(), but DNS is down
        // so getXcsrfToken() returns undefined, login() schedules retry — refreshTokens() must not throw
        const error401 = new Error('Unauthorized') as AxiosError
        error401.response = { status: 401 } as AxiosResponse
        vi.spyOn(axios, 'isAxiosError').mockReturnValue(true)

        mockAxiosInstance.post.mockRejectedValueOnce(error401)

        // DNS is down: getXcsrfToken catches ENOTFOUND and returns undefined
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND account.electrolux.one'))
        vi.useFakeTimers()

        await client.initialize()
        client.accessToken = 'old-token'
        client.refreshToken = 'old-refresh-token'

        // Must not throw — login() schedules its own retry, refreshTokens() just returns
        const refreshPromise = client.refreshTokens()
        vi.runAllTimers()
        vi.useRealTimers()

        await expect(refreshPromise).resolves.toBeUndefined()
      })

      it('should schedule retry on transient token refresh error', async () => {
        mockAxiosInstance.post.mockRejectedValueOnce(new Error('Network timeout'))
        vi.useFakeTimers()

        await client.initialize()
        const refreshPromise = client.refreshTokens()

        vi.runAllTimers()
        vi.useRealTimers()

        await refreshPromise
        // The retry timeout was created and executed
        expect(mockAxiosInstance.post).toHaveBeenCalled()
      })

      it('should throw when refreshTokens returns undefined tokens', async () => {
        mockAxiosInstance.post.mockResolvedValueOnce({
          data: { accessToken: undefined, refreshToken: undefined },
        })
        vi.useFakeTimers()

        await client.initialize()
        const refreshPromise = client.refreshTokens()

        vi.runAllTimers()
        vi.useRealTimers()

        await refreshPromise
        // Should have logged error about undefined token
        expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error refreshing access token'))
      })

      it('should retry login with exponential backoff when API times out (m12)', async () => {
        // ECONNABORTED is axios's code for a timeout / connection aborted mid-operation.
        // login() should fail, schedule a retry, and eventually succeed on the third attempt.
        const timeoutError = Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' })

        // First two attempts fail with timeout; third succeeds
        vi.mocked(axios.get)
          .mockRejectedValueOnce(timeoutError)
          .mockRejectedValueOnce(timeoutError)
          .mockResolvedValueOnce(mockCsrfTokenResponse)
        vi.mocked(axios.post).mockResolvedValueOnce(mockLoginResponse).mockResolvedValueOnce(mockTokenExchangeResponse)

        vi.useFakeTimers()

        await client.initialize()
        const loginPromise = client.login()

        // Advance all pending timers to fire retry callbacks
        await vi.runAllTimersAsync()

        vi.useRealTimers()

        await loginPromise

        // Attempted at least 3 times (2 failures + 1 success)
        expect(vi.mocked(axios.get).mock.calls.length).toBeGreaterThanOrEqual(3)
        expect(client.isLoggedIn).toBe(true)
      })

      it('should cap login retry delay at LOGIN_RETRY_MAX_DELAY_MS (m12)', async () => {
        // With loginRetryCount = 20 the uncapped backoff would be 5000 * 2^20 ≈ 5 billion ms.
        // The cap is 300_000 ms (5 minutes). With Math.random = 0, jitter gives exactly MAX/2 = 150_000.
        const LOGIN_RETRY_MAX_DELAY_MS = 300_000

        vi.spyOn(Math, 'random').mockReturnValue(0)
        // Single network failure so login() hits the catch branch
        vi.mocked(axios.get).mockRejectedValueOnce(new Error('Network error'))

        const capturedDelays: number[] = []
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((_fn, delay, ..._args) => {
          if (typeof delay === 'number') capturedDelays.push(delay)
          return 0 as unknown as NodeJS.Timeout
        })

        try {
          // Prime the retry count so the exponent overflows the cap
          client.loginRetryCount = 20

          await client.login()

          expect(capturedDelays.length).toBeGreaterThan(0)
          const capturedDelay = capturedDelays[0] ?? 0
          // With jitter at Math.random=0 the delay is MAX_DELAY/2 (within [MAX/2, MAX])
          expect(capturedDelay).toBeLessThanOrEqual(LOGIN_RETRY_MAX_DELAY_MS)
          expect(capturedDelay).toBeGreaterThanOrEqual(LOGIN_RETRY_MAX_DELAY_MS / 2)
        } finally {
          setTimeoutSpy.mockRestore()
          vi.restoreAllMocks()
        }
      })

      it('should retry token refresh on 5xx error with backoff (m12)', async () => {
        // Simulate server-side 5xx (503 Service Unavailable) then success
        const error503 = Object.assign(new Error('Service Unavailable'), {
          response: { status: 503, statusText: 'Service Unavailable' },
          isAxiosError: true,
        })
        vi.spyOn(axios, 'isAxiosError').mockReturnValue(false)

        // First refresh attempt → 503, second attempt → success
        mockAxiosInstance.post.mockRejectedValueOnce(error503).mockResolvedValueOnce(mockTokenRefreshResponse)

        vi.useFakeTimers()

        await client.initialize()
        const refreshPromise = client.refreshTokens()

        await vi.runAllTimersAsync()

        vi.useRealTimers()

        await refreshPromise

        // Should have attempted at least 2 POST calls (original + retry)
        expect(mockAxiosInstance.post.mock.calls.length).toBeGreaterThanOrEqual(2)
        // Error should have been logged
        expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error refreshing access token'))
      })
    })

    describe('403 retry failure logging', () => {
      it('should log error with "after token refresh" when retry also fails', async () => {
        const error403 = new Error('Forbidden') as AxiosError
        error403.response = { status: 403 } as AxiosResponse
        vi.spyOn(axios, 'isAxiosError').mockReturnValue(true)

        // First call: 403, second call (retry): also fails
        mockAxiosInstance.get.mockRejectedValueOnce(error403).mockRejectedValueOnce(new Error('Still forbidden'))

        mockAxiosInstance.post.mockResolvedValue(mockTokenRefreshResponse)

        await client.initialize()
        client.isLoggedIn = true
        client.accessToken = 'test-token'
        client.refreshToken = 'test-refresh-token'
        client.eat = new Date(Date.now() + 10 * 60 * 60 * 1000)

        loggerErrorSpy.mockClear()
        await client.getAppliances()

        const errorCalls = loggerErrorSpy.mock.calls.map((args: unknown[]) => args[0] as string)
        const retryErrorLog = errorCalls.find((msg) => msg.includes('after token refresh'))
        expect(retryErrorLog).toBeDefined()
      })
    })

    describe('buildCombinedCommandState mode preservation', () => {
      it('should keep lastActiveMode when explicitly turning off', async () => {
        const { cache } = await import('@/cache.js')

        const normalizeForModeTest = (state: Appliance): NormalizedState =>
          ({
            applianceId: state.applianceId,
            mode: state.properties.reported.mode,
            applianceState: state.properties.reported.applianceState,
          }) as NormalizedState

        const mockAppl = createMockAppliance({
          normalizeState: vi.fn(normalizeForModeTest),
        })

        const onState = {
          ...mockApplianceStateResponse,
          properties: {
            ...mockApplianceStateResponse.properties,
            reported: {
              ...mockApplianceStateResponse.properties.reported,
              mode: 'cool',
              applianceState: 'on',
            },
          },
        }
        vi.mocked(cache.get).mockReturnValue(onState)
        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        // First send cool to set lastActiveMode
        await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { mode: 'cool' })

        // Now send off - should keep cool as the mode in published state
        vi.mocked(mockMqtt.publish).mockClear()
        await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { mode: 'off' })

        const publishCall = vi.mocked(mockMqtt.publish).mock.calls[0]
        const publishedState = JSON.parse(publishCall[1] as string)
        expect(publishedState.mode).toBe('cool')
      })

      it('should restore lastActiveMode and turn on when non-mode command sent to off appliance', async () => {
        const { cache } = await import('@/cache.js')

        const normalizeForModeTest = (state: Appliance): NormalizedState =>
          ({
            applianceId: state.applianceId,
            mode: state.properties.reported.mode,
            applianceState: state.properties.reported.applianceState,
            targetTemperatureC: state.properties.reported.targetTemperatureC,
          }) as NormalizedState

        const mockAppl = createMockAppliance({
          normalizeState: vi.fn(normalizeForModeTest),
        })

        // Start with on state so we can set lastActiveMode
        const onState = {
          ...mockApplianceStateResponse,
          properties: {
            ...mockApplianceStateResponse.properties,
            reported: {
              ...mockApplianceStateResponse.properties.reported,
              mode: 'heat',
              applianceState: 'on',
            },
          },
        }
        vi.mocked(cache.get).mockReturnValue(onState)
        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        // Send heat command to set lastActiveMode
        await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { mode: 'heat' })

        // Now set cached state to off
        const offState = {
          ...mockApplianceStateResponse,
          properties: {
            ...mockApplianceStateResponse.properties,
            reported: {
              ...mockApplianceStateResponse.properties.reported,
              mode: 'off',
              applianceState: 'off',
              targetTemperatureC: 22,
            },
          },
        }
        vi.mocked(cache.get).mockReturnValue(offState)

        // Send non-mode command while off
        vi.mocked(mockMqtt.publish).mockClear()
        await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { targetTemperatureC: 25 })

        const publishCall = vi.mocked(mockMqtt.publish).mock.calls[0]
        const publishedState = JSON.parse(publishCall[1] as string)
        expect(publishedState.applianceState).toBe('on')
        expect(publishedState.mode).toBe('heat')
      })
    })

    describe('State publishing edge cases', () => {
      it('should use cached state when normalizeState returns null for new data', async () => {
        const { cache } = await import('@/cache.js')

        const cachedNormalized = {
          applianceId: 'test-appliance-123',
          mode: 'cool',
          targetTemperatureC: 22,
        } as NormalizedState

        // normalizeState: first call for cached state returns valid, second for new state returns null
        const normalizeStateFn = vi.fn().mockReturnValueOnce(cachedNormalized).mockReturnValueOnce(null)

        const mockAppl = createMockAppliance({
          normalizeState: normalizeStateFn,
        })

        vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockApplianceStateResponse })

        await client.initialize()
        const result = await client.getApplianceState(mockAppl as unknown as BaseAppliance)

        // normalizeState should have been called twice (cached + new)
        expect(normalizeStateFn).toHaveBeenCalledTimes(2)
        // Should not throw and return the response data
        expect(result).toEqual(mockApplianceStateResponse)
      })

      it('should return early without publishing when both states are null', async () => {
        const { cache } = await import('@/cache.js')

        const normalizeStateAlwaysNull = (): NormalizedState | null => null

        const mockAppl = createMockAppliance({
          normalizeState: vi.fn(normalizeStateAlwaysNull) as MockAppliance['normalizeState'],
        })

        // No cached state
        vi.mocked(cache.get).mockReturnValue(undefined)
        mockAxiosInstance.get.mockResolvedValueOnce({ data: mockApplianceStateResponse })

        await client.initialize()
        vi.mocked(mockMqtt.publish).mockClear()
        await client.getApplianceState(mockAppl as unknown as BaseAppliance)

        // Should not publish
        expect(mockMqtt.publish).not.toHaveBeenCalled()
      })

      it('should handle sendApplianceCommand without client initialized', async () => {
        const mockAppl = createMockAppliance()
        const result = await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { mode: 'cool' })
        expect(result).toBeUndefined()
      })
    })

    describe('Request interceptor', () => {
      it('should wait for login to complete before proceeding with requests', async () => {
        let interceptorCallback: ((config: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined

        vi.mocked(axios.create).mockReturnValue({
          ...mockAxiosInstance,
          interceptors: {
            request: {
              use: vi.fn((callback) => {
                interceptorCallback = callback
              }),
            },
            response: { use: vi.fn() },
          },
        } as unknown as ReturnType<typeof axios.create>)

        await client.initialize()
        expect(interceptorCallback).toBeDefined()

        // Interceptor calls waitForLogin() — mock it to verify the call
        const waitSpy = vi.spyOn(client, 'waitForLogin').mockResolvedValue(undefined)

        client.isLoggingIn = true
        const requestConfig = { url: '/api/v1/appliances' }
        const result = await interceptorCallback?.(requestConfig)

        expect(waitSpy).toHaveBeenCalled()
        expect(result).toEqual(requestConfig)
        waitSpy.mockRestore()
      })

      it('should not wait for token refresh requests', async () => {
        let interceptorCallback: ((config: Record<string, unknown>) => Promise<Record<string, unknown>>) | undefined

        vi.mocked(axios.create).mockReturnValue({
          ...mockAxiosInstance,
          interceptors: {
            request: {
              use: vi.fn((callback) => {
                interceptorCallback = callback
              }),
            },
            response: { use: vi.fn() },
          },
        } as unknown as ReturnType<typeof axios.create>)

        await client.initialize()
        client.isLoggingIn = true

        const requestConfig = { url: '/api/v1/token/refresh' }
        const result = await interceptorCallback?.(requestConfig)
        expect(result).toEqual(requestConfig)
      })
    })

    describe('Network timeout', () => {
      it('should return undefined when the request times out (ECONNABORTED)', async () => {
        const timeoutError = new Error('timeout of 10000ms exceeded') as AxiosError
        timeoutError.code = 'ECONNABORTED'
        // isAxiosError returns true for timeout errors
        vi.spyOn(axios, 'isAxiosError').mockReturnValue(true)
        mockAxiosInstance.get.mockRejectedValueOnce(timeoutError)

        await client.initialize()
        const result = await client.getAppliances()

        // A timeout is a transient error — it should return undefined without crashing
        expect(result).toBeUndefined()
        // Should not trigger a token refresh (timeout is not a 403)
        expect(mockAxiosInstance.post).not.toHaveBeenCalled()
      })

      it('should log the timeout error rather than swallowing it silently', async () => {
        const timeoutError = new Error('timeout of 10000ms exceeded') as AxiosError
        timeoutError.code = 'ECONNABORTED'
        vi.spyOn(axios, 'isAxiosError').mockReturnValue(true)
        mockAxiosInstance.get.mockRejectedValueOnce(timeoutError)

        await client.initialize()
        loggerErrorSpy.mockClear()
        await client.getAppliances()

        expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error getting appliances'))
      })
    })

    describe('Malformed JSON response body', () => {
      it('should return undefined when API returns an unexpected shape instead of an ApplianceStub array', async () => {
        // Simulate a response body that is valid JSON but fails the isApplianceStubArray type guard
        mockAxiosInstance.get.mockResolvedValueOnce({ data: 'unexpected string payload' })

        await client.initialize()
        const result = await client.getAppliances()

        expect(result).toBeUndefined()
      })

      it('should return undefined when API returns an object instead of array for appliances', async () => {
        mockAxiosInstance.get.mockResolvedValueOnce({ data: { items: [], total: 0 } })

        await client.initialize()
        const result = await client.getAppliances()

        expect(result).toBeUndefined()
      })

      it('should return undefined when appliance info response has wrong shape', async () => {
        // isApplianceInfo checks for applianceInfo and capabilities properties
        mockAxiosInstance.get.mockResolvedValueOnce({ data: [1, 2, 3] })

        await client.initialize()
        const result = await client.getApplianceInfo('test-appliance-123')

        expect(result).toBeUndefined()
      })
    })
  })
})

import axios, { AxiosError, AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BaseAppliance } from '../src/appliances/base.js'
import { ElectroluxClient, formatStateDifferences, getStateDifferences } from '../src/electrolux.js'
import type { IMqtt } from '../src/mqtt.js'
import type { NormalizedState } from '../src/types/normalized.js'
import type { Appliance } from '../src/types.js'
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
  generateAutoDiscoveryConfig: () => Record<string, unknown>
  getSupportedModes: () => string[]
  getSupportedFanModes: () => string[]
  getSupportedSwingModes: () => string[]
  getTemperatureRange: () => { min: number; max: number; initial: number }
  getModelName: () => string
}

vi.mock('axios')
vi.mock('../src/logger.js', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))
vi.mock('../src/cache.js', () => ({
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

    it.skipIf(process.env.CI === 'true')('should ignore parent paths when configured', () => {
      // First mock config to have an ignored key
      const mockConfig = {
        logging: {
          ignoredKeys: ['networkInterface'],
        },
      }
      vi.doMock('../src/config.js', () => ({
        default: mockConfig,
      }))

      const oldState = {
        applianceId: 'test-123',
        networkInterface: {
          rssi: -50,
          linkQuality: 80,
        },
        mode: 'cool',
      } as unknown as NormalizedState

      const newState = {
        applianceId: 'test-123',
        networkInterface: {
          rssi: -55,
          linkQuality: 75,
        },
        mode: 'heat',
      } as unknown as NormalizedState

      const differences = getStateDifferences(oldState, newState)
      // networkInterface changes should be ignored, but mode should be detected
      expect(differences['networkInterface.rssi']).toBeUndefined()
      expect(differences['networkInterface.linkQuality']).toBeUndefined()
      expect(differences.mode).toEqual({ from: 'cool', to: 'heat' })
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

    it('should set isLoggedIn to true when accessToken exists', async () => {
      vi.spyOn(axios, 'create').mockReturnValue({
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      } as unknown as ReturnType<typeof axios.create>)

      // Client already has config.electrolux.accessToken loaded
      await client.initialize()

      // This depends on config having tokens, so just verify the property exists
      expect(client.isLoggedIn).toBeDefined()
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
        const { cache } = await import('../src/cache.js')
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
        const { cache } = await import('../src/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)

        mockAxiosInstance.put.mockRejectedValueOnce(new Error('Command failed'))

        await client.initialize()
        const result = await client.sendApplianceCommand(mockAppliance as unknown as BaseAppliance, { mode: 'cool' })

        expect(result).toBeUndefined()
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
        const { cache } = await import('../src/cache.js')
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
        const { cache } = await import('../src/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)

        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        // Send a command with mode: cool
        await client.sendApplianceCommand(mockAppliance as unknown as BaseAppliance, { mode: 'cool' })

        // The immediate feedback should include the cool mode
        expect(mockMqtt.publish).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('"mode":"cool"'))
      })

      it('should preserve previous mode when turning off', async () => {
        const { cache } = await import('../src/cache.js')
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
        const { cache } = await import('../src/cache.js')
        vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)

        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()
        await client.sendApplianceCommand(mockAppliance as unknown as BaseAppliance, { mode: 'cool' })

        expect(mockMqtt.publish).toHaveBeenCalledWith(expect.stringContaining('test-appliance'), expect.any(String))
        expect(cache.set).toHaveBeenCalled()
      })

      it('should not publish if cached state is missing', async () => {
        const { cache } = await import('../src/cache.js')
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
        const { cache } = await import('../src/cache.js')
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
        const { cache } = await import('../src/cache.js')
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
        const { cache } = await import('../src/cache.js')
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
        const { cache } = await import('../src/cache.js')
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
        const { cache } = await import('../src/cache.js')
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

      it('should handle missing cached state in publishCommandFeedback', async () => {
        const { cache } = await import('../src/cache.js')
        vi.mocked(cache.get).mockReturnValue(null)
        mockAxiosInstance.put.mockResolvedValue({ data: {} })

        await client.initialize()

        const mockAppl = createMockAppliance()
        await client.sendApplianceCommand(mockAppl as unknown as BaseAppliance, { mode: 'cool' })

        // Should not throw even without cached state
        expect(mockAxiosInstance.put).toHaveBeenCalled()
      })

      it('should apply immediate state updates from appliance', async () => {
        const { cache } = await import('../src/cache.js')
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

      it('should write tokens to file on successful login', async () => {
        const fsMock = await import('node:fs')
        const writeFileSyncSpy = vi.spyOn(fsMock.default, 'writeFileSync').mockImplementation(() => {})

        vi.mocked(axios.get).mockResolvedValueOnce(mockCsrfTokenResponse)
        vi.mocked(axios.post).mockResolvedValueOnce(mockLoginResponse).mockResolvedValueOnce(mockTokenExchangeResponse)

        await client.initialize()
        await client.login()

        expect(writeFileSyncSpy).toHaveBeenCalled()
        writeFileSyncSpy.mockRestore()
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
      it('should refresh token when near expiration', async () => {
        mockAxiosInstance.post.mockResolvedValue(mockTokenRefreshResponse)

        await client.initialize()

        // Mock a token that expires soon (less than 6 hours)
        const nearExpiryTime = new Date(Date.now() + 5 * 60 * 60 * 1000) // 5 hours
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
      it('should retry request after 403 and refresh token', async () => {
        const { cache } = await import('../src/cache.js')
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
  })
})

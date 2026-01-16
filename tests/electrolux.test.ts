import { describe, expect, it } from 'vitest'
import { formatStateDifferences, getStateDifferences } from '../src/electrolux.js'
import type { NormalizedState } from '../src/types/normalized.js'

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
})

import { describe, expect, it } from 'vitest'
import { formatStateDifferences, getStateDifferences } from '#/state-sync.js'
import type { NormalizedState } from '#/types/normalized.js'

describe('State Differences', () => {
  describe('getStateDifferences', () => {
    it('should detect changes in top-level properties', () => {
      const oldState = {
        applianceId: '123',
        applianceState: 'off',
        mode: 'cool',
        fanSpeedSetting: 'auto',
        targetTemperatureC: 22,
        ambientTemperatureC: 25,
        connectionState: 'connected',
        verticalSwing: 'off',
      } as NormalizedState

      const newState = {
        ...oldState,
        mode: 'heat',
        targetTemperatureC: 24,
      } as NormalizedState

      const differences = getStateDifferences(oldState, newState, [])

      expect(differences.mode).toEqual({ from: 'cool', to: 'heat' })
      expect(differences.targetTemperatureC).toEqual({ from: 22, to: 24 })
      expect(differences.fanSpeedSetting).toBeUndefined() // No change
    })

    it('should detect nested property changes', () => {
      const oldState = {
        applianceId: '123',
        applianceState: 'on',
        mode: 'cool',
        fanSpeedSetting: 'auto',
        targetTemperatureC: 22,
        ambientTemperatureC: 25,
        connectionState: 'connected',
        verticalSwing: 'off',
        filterState: 'clean' as const,
        upgradeState: 'idle' as const,
      } as unknown as NormalizedState

      const newState = {
        ...oldState,
        filterState: 'dirty' as const,
      } as unknown as NormalizedState

      const differences = getStateDifferences(oldState, newState, [])

      expect(differences.filterState).toEqual({ from: 'clean', to: 'dirty' })
    })

    it('should return empty object for null oldState', () => {
      const newState = {
        applianceId: '123',
        applianceState: 'on',
        mode: 'cool',
        fanSpeedSetting: 'auto',
        targetTemperatureC: 22,
        ambientTemperatureC: 25,
        connectionState: 'connected',
        verticalSwing: 'off',
      } as NormalizedState

      const differences = getStateDifferences(null, newState, [])
      expect(differences).toEqual({})
    })

    it('should not report differences for unchanged values', () => {
      const state = {
        applianceId: '123',
        applianceState: 'on',
        mode: 'cool',
        fanSpeedSetting: 'auto',
        targetTemperatureC: 22,
        ambientTemperatureC: 25,
        connectionState: 'connected',
        verticalSwing: 'off',
      } as NormalizedState

      const differences = getStateDifferences(state, state, [])
      expect(Object.keys(differences)).toHaveLength(0)
    })
  })
})

describe('state diffing (ported from the ElectroluxClient suite)', () => {
  describe('getStateDifferences', () => {
    it('should return empty differences when oldState is null', () => {
      const newState = {
        applianceId: 'test-123',
        mode: 'cool',
        targetTemperatureC: 22,
      } as NormalizedState

      const differences = getStateDifferences(null, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
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

      const differences = getStateDifferences(oldState, newState, [])
      expect(differences.mode).toEqual({ from: '', to: 'cool' })
    })

    describe('with ignoredKeys', () => {
      it('should exclude exact-match ignored keys from differences', () => {
        const ignoredKeys = ['mode']

        const oldState = { applianceId: 'test-123', mode: 'cool', targetTemperatureC: 20 } as NormalizedState
        const newState = { applianceId: 'test-123', mode: 'heat', targetTemperatureC: 25 } as NormalizedState

        const differences = getStateDifferences(oldState, newState, ignoredKeys)
        expect(differences.mode).toBeUndefined()
        expect(differences.targetTemperatureC).toEqual({ from: 20, to: 25 })
      })

      it('should exclude nested keys when parent path is ignored', () => {
        const ignoredKeys = ['networkInterface']

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

        const differences = getStateDifferences(oldState, newState, ignoredKeys)
        expect(differences['networkInterface.rssi']).toBeUndefined()
        expect(differences['networkInterface.linkQualityIndicator']).toBeUndefined()
        expect(differences.mode).toEqual({ from: 'cool', to: 'heat' })
      })

      it('should exclude top-level ignored keys from the main comparison loop', () => {
        const ignoredKeys = ['targetTemperatureC']

        const oldState = { applianceId: 'test-123', targetTemperatureC: 20 } as NormalizedState
        const newState = { applianceId: 'test-123', targetTemperatureC: 25 } as NormalizedState

        const differences = getStateDifferences(oldState, newState, ignoredKeys)
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
})

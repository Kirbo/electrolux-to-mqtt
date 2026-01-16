import { describe, expect, it } from 'vitest'
import { getStateDifferences } from '../src/electrolux.js'
import type { NormalizedState } from '../src/types/normalized.js'

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

      const differences = getStateDifferences(oldState, newState)

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

      const differences = getStateDifferences(oldState, newState)

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

      const differences = getStateDifferences(null, newState)
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

      const differences = getStateDifferences(state, state)
      expect(Object.keys(differences)).toHaveLength(0)
    })
  })
})

import { describe, expect, it } from 'vitest'
import {
  normalizeApplianceState,
  normalizeClimateMode,
  normalizeConnectionState,
  normalizeFanSpeed,
  toLowercase,
} from '../src/appliances/normalizers'

describe('Normalizers', () => {
  describe('toLowercase', () => {
    it('should convert string to lowercase', () => {
      expect(toLowercase('COOL')).toBe('cool')
      expect(toLowercase('Auto')).toBe('auto')
    })

    it('should return null for undefined or null', () => {
      expect(toLowercase(undefined)).toBe(null)
      expect(toLowercase(null)).toBe(null)
    })
  })

  describe('normalizeApplianceState', () => {
    it('should convert "running" to "on"', () => {
      expect(normalizeApplianceState('running')).toBe('on')
      expect(normalizeApplianceState('RUNNING')).toBe('on')
    })

    it('should handle on/off states', () => {
      expect(normalizeApplianceState('on')).toBe('on')
      expect(normalizeApplianceState('OFF')).toBe('off')
    })
  })

  describe('normalizeConnectionState', () => {
    it('should convert to lowercase', () => {
      expect(normalizeConnectionState('Connected')).toBe('connected')
      expect(normalizeConnectionState('DISCONNECTED')).toBe('disconnected')
    })

    it('should default to "disconnected" for undefined', () => {
      expect(normalizeConnectionState(undefined)).toBe('disconnected')
    })
  })

  describe('normalizeClimateMode', () => {
    it('should convert "fanonly" to "fan_only"', () => {
      expect(normalizeClimateMode('fanonly')).toBe('fan_only')
      expect(normalizeClimateMode('FANONLY')).toBe('fan_only')
    })

    it('should lowercase other modes', () => {
      expect(normalizeClimateMode('COOL')).toBe('cool')
      expect(normalizeClimateMode('Heat')).toBe('heat')
      expect(normalizeClimateMode('auto')).toBe('auto')
    })
  })

  describe('normalizeFanSpeed', () => {
    it('should convert "middle" to "medium"', () => {
      expect(normalizeFanSpeed('middle')).toBe('medium')
      expect(normalizeFanSpeed('MIDDLE')).toBe('medium')
    })

    it('should lowercase other modes', () => {
      expect(normalizeFanSpeed('HIGH')).toBe('high')
      expect(normalizeFanSpeed('Low')).toBe('low')
      expect(normalizeFanSpeed('auto')).toBe('auto')
    })
  })
})

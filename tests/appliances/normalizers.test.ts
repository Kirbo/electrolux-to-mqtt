import { describe, expect, it } from 'vitest'
import {
  denormalizeClimateMode,
  denormalizeFanSpeed,
  extractReportedState,
  normalizeApplianceState,
  normalizeBaseFields,
  normalizeClimateAppliance,
  normalizeClimateMode,
  normalizeConnectionState,
  normalizeEnabledState,
  normalizeFanSpeed,
  normalizeFilterState,
  normalizeLinkQuality,
  normalizeOnOffNullable,
  normalizeOnOffState,
  normalizeTemperatureUnit,
  normalizeUpgradeState,
} from '@/appliances/normalizers.js'
import type { Appliance } from '@/types.js'

describe('normalizers', () => {
  describe('denormalizeClimateMode', () => {
    it('should convert fan_only to FANONLY', () => {
      expect(denormalizeClimateMode('fan_only')).toBe('FANONLY')
    })

    it('should uppercase other modes', () => {
      expect(denormalizeClimateMode('cool')).toBe('COOL')
      expect(denormalizeClimateMode('heat')).toBe('HEAT')
      expect(denormalizeClimateMode('auto')).toBe('AUTO')
    })

    it('should handle undefined', () => {
      expect(denormalizeClimateMode(undefined)).toBe('')
    })
  })

  describe('denormalizeFanSpeed', () => {
    it('should convert medium to MIDDLE', () => {
      expect(denormalizeFanSpeed('medium')).toBe('MIDDLE')
    })

    it('should convert middle to MIDDLE', () => {
      expect(denormalizeFanSpeed('middle')).toBe('MIDDLE')
    })

    it('should uppercase other speeds', () => {
      expect(denormalizeFanSpeed('low')).toBe('LOW')
      expect(denormalizeFanSpeed('high')).toBe('HIGH')
    })

    it('should handle undefined', () => {
      expect(denormalizeFanSpeed(undefined)).toBe('')
    })
  })

  describe('normalizeConnectionState', () => {
    it('should lowercase connection state', () => {
      expect(normalizeConnectionState('Connected')).toBe('connected')
      expect(normalizeConnectionState('DISCONNECTED')).toBe('disconnected')
    })

    it('should default to disconnected for undefined', () => {
      expect(normalizeConnectionState(undefined)).toBe('disconnected')
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

    it('should default to "off" for undefined or unknown values', () => {
      expect(normalizeApplianceState(undefined)).toBe('off')
      expect(normalizeApplianceState('UNKNOWN_STATE')).toBe('off')
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

    it('should default to "off" for undefined or unknown values', () => {
      expect(normalizeClimateMode(undefined)).toBe('off')
      expect(normalizeClimateMode('UNKNOWN_MODE')).toBe('off')
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

    it('should default to "auto" for undefined or unknown values', () => {
      expect(normalizeFanSpeed(undefined)).toBe('auto')
      expect(normalizeFanSpeed('UNKNOWN_SPEED')).toBe('auto')
    })
  })

  describe('normalizeEnabledState', () => {
    it('should normalize valid states', () => {
      expect(normalizeEnabledState('enabled')).toBe('enabled')
      expect(normalizeEnabledState('DISABLED')).toBe('disabled')
      expect(normalizeEnabledState('Enabled')).toBe('enabled')
    })

    it('should default to "disabled" for undefined or unknown', () => {
      expect(normalizeEnabledState(undefined)).toBe('disabled')
      expect(normalizeEnabledState('UNKNOWN')).toBe('disabled')
    })
  })

  describe('normalizeLinkQuality', () => {
    it('should normalize valid qualities', () => {
      expect(normalizeLinkQuality('EXCELLENT')).toBe('excellent')
      expect(normalizeLinkQuality('VERY_GOOD')).toBe('very_good')
      expect(normalizeLinkQuality('GOOD')).toBe('good')
      expect(normalizeLinkQuality('POOR')).toBe('poor')
      expect(normalizeLinkQuality('VERY_POOR')).toBe('very_poor')
      expect(normalizeLinkQuality('UNDEFINED')).toBe('undefined')
    })

    it('should default to "undefined" for null/undefined/unknown', () => {
      expect(normalizeLinkQuality(undefined)).toBe('undefined')
      expect(normalizeLinkQuality(null)).toBe('undefined')
      expect(normalizeLinkQuality('UNKNOWN')).toBe('undefined')
    })
  })

  describe('normalizeOnOffState', () => {
    it('should normalize valid states', () => {
      expect(normalizeOnOffState('ON')).toBe('on')
      expect(normalizeOnOffState('off')).toBe('off')
    })

    it('should default to "off" for null/undefined/unknown', () => {
      expect(normalizeOnOffState(undefined)).toBe('off')
      expect(normalizeOnOffState(null)).toBe('off')
      expect(normalizeOnOffState('UNKNOWN')).toBe('off')
    })
  })

  describe('normalizeOnOffNullable', () => {
    it('should normalize valid states', () => {
      expect(normalizeOnOffNullable('ON')).toBe('on')
      expect(normalizeOnOffNullable('off')).toBe('off')
    })

    it('should return null for null/undefined/unknown', () => {
      expect(normalizeOnOffNullable(undefined)).toBeNull()
      expect(normalizeOnOffNullable(null)).toBeNull()
      expect(normalizeOnOffNullable('UNKNOWN')).toBeNull()
    })
  })

  describe('normalizeUpgradeState', () => {
    it('should normalize valid states', () => {
      expect(normalizeUpgradeState('IDLE')).toBe('idle')
      expect(normalizeUpgradeState('upgrading')).toBe('upgrading')
    })

    it('should return null for null/undefined/unknown', () => {
      expect(normalizeUpgradeState(undefined)).toBeNull()
      expect(normalizeUpgradeState(null)).toBeNull()
      expect(normalizeUpgradeState('UNKNOWN')).toBeNull()
    })
  })

  describe('normalizeTemperatureUnit', () => {
    it('should normalize valid units', () => {
      expect(normalizeTemperatureUnit('celsius')).toBe('celsius')
      expect(normalizeTemperatureUnit('FAHRENHEIT')).toBe('fahrenheit')
    })

    it('should default to "celsius" for null/undefined/unknown', () => {
      expect(normalizeTemperatureUnit(undefined)).toBe('celsius')
      expect(normalizeTemperatureUnit(null)).toBe('celsius')
      expect(normalizeTemperatureUnit('KELVIN')).toBe('celsius')
    })
  })

  describe('normalizeFilterState', () => {
    it('should normalize valid states', () => {
      expect(normalizeFilterState('CLEAN')).toBe('clean')
      expect(normalizeFilterState('good')).toBe('good')
      expect(normalizeFilterState('DIRTY')).toBe('dirty')
    })

    it('should default to "clean" for null/undefined/unknown', () => {
      expect(normalizeFilterState(undefined)).toBe('clean')
      expect(normalizeFilterState(null)).toBe('clean')
      expect(normalizeFilterState('UNKNOWN')).toBe('clean')
    })
  })

  describe('extractReportedState', () => {
    it('should extract nested reported state', () => {
      const appliance = {
        applianceId: '123',
        properties: {
          reported: {
            applianceState: 'ON',
            mode: 'COOL',
          },
        },
      } as unknown as Appliance

      const result = extractReportedState(appliance)
      expect(result.applianceState).toBe('ON')
      expect(result.mode).toBe('COOL')
    })

    it('should handle flat structure', () => {
      const appliance = {
        applianceState: 'ON',
        mode: 'COOL',
        deviceId: 'device-123',
        dataModelVersion: '1.0.0',
      } as unknown as Appliance

      const result = extractReportedState(appliance)
      expect(result.applianceState).toBe('ON')
      expect(result.mode).toBe('COOL')
    })

    it('should throw on invalid state structure', () => {
      const invalid = { someRandomField: 'value' } as unknown as Appliance

      expect(() => extractReportedState(invalid)).toThrow('Invalid appliance state')
    })
  })

  describe('normalizeBaseFields', () => {
    it('should normalize identity fields', () => {
      const appliance: Appliance = {
        applianceId: 'test-123',
        status: 'Enabled',
        connectionState: 'Connected',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        applianceName: 'Test AC',
        properties: {
          reported: {
            applianceState: 'running',
            deviceId: 'device-123',
            dataModelVersion: 1,
            $version: 5,
          },
        },
      } as unknown as Appliance

      const result = normalizeBaseFields(appliance)

      expect(result.applianceId).toBe('test-123')
      expect(result.status).toBe('enabled')
      expect(result.connectionState).toBe('connected')
      expect(result.applianceState).toBe('on')
      expect(result.deviceId).toBe('device-123')
      expect(result.dataModelVersion).toBe(1)
      expect(result.version).toBe(5)
    })

    it('should normalize network interface', () => {
      const appliance: Appliance = {
        applianceId: 'test-123',
        properties: {
          reported: {
            networkInterface: {
              linkQualityIndicator: 'Good',
              rssi: -45,
            },
          },
        },
      } as unknown as Appliance

      const result = normalizeBaseFields(appliance)

      expect(result.networkInterface?.linkQualityIndicator).toBe('good')
      expect(result.networkInterface?.rssi).toBe(-45)
    })

    it('should normalize appliance data', () => {
      const appliance: Appliance = {
        applianceId: 'test-123',
        properties: {
          reported: {
            applianceData: {
              elc: 'ELC123',
              mac: 'AA:BB:CC:DD:EE:FF',
              pnc: 'PNC123',
              sn: 'SN123',
            },
          },
        },
      } as unknown as Appliance

      const result = normalizeBaseFields(appliance)

      expect(result.applianceData).toEqual({
        elc: 'ELC123',
        mac: 'AA:BB:CC:DD:EE:FF',
        pnc: 'PNC123',
        sn: 'SN123',
      })
    })

    it('should normalize scheduler fields', () => {
      const appliance: Appliance = {
        applianceId: 'test-123',
        properties: {
          reported: {
            schedulerMode: 'ON',
            schedulerSession: 'OFF',
            startTime: '08:00',
            stopTime: '22:00',
          },
        },
      } as unknown as Appliance

      const result = normalizeBaseFields(appliance)

      expect(result.schedulerMode).toBe('on')
      expect(result.schedulerSession).toBe('off')
      expect(result.startTime).toBe('08:00')
      expect(result.stopTime).toBe('22:00')
    })

    it('should normalize firmware versions', () => {
      const appliance: Appliance = {
        applianceId: 'test-123',
        properties: {
          reported: {
            VmNo_MCU: '1.2.3',
            VmNo_NIU: '4.5.6',
          },
        },
      } as unknown as Appliance

      const result = normalizeBaseFields(appliance)

      expect(result.VmNo_MCU).toBe('1.2.3')
      expect(result.VmNo_NIU).toBe('4.5.6')
    })
  })

  describe('normalizeClimateAppliance', () => {
    it('should normalize complete climate appliance', () => {
      const appliance: Appliance = {
        applianceId: 'test-123',
        status: 'Enabled',
        connectionState: 'Connected',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        applianceName: 'Test AC',
        properties: {
          reported: {
            applianceState: 'running',
            mode: 'COOL',
            targetTemperatureC: 22,
            ambientTemperatureC: 25,
            ambientTemperatureF: 77,
            temperatureRepresentation: 'Celsius',
            fanSpeedSetting: 'MIDDLE',
            verticalSwing: 'ON',
            sleepMode: 'OFF',
            compressorState: 'ON',
            filterState: 'Good',
          },
        },
      } as unknown as Appliance

      const result = normalizeClimateAppliance(appliance)

      expect(result.applianceId).toBe('test-123')
      expect(result.applianceState).toBe('on')
      expect(result.mode).toBe('cool')
      expect(result.targetTemperatureC).toBe(22)
      expect(result.ambientTemperatureC).toBe(25)
      expect(result.ambientTemperatureF).toBe(77)
      expect(result.temperatureRepresentation).toBe('celsius')
      expect(result.fanSpeedSetting).toBe('medium')
      expect(result.verticalSwing).toBe('on')
      expect(result.sleepMode).toBe('off')
      expect(result.compressorState).toBe('on')
      expect(result.filterState).toBe('good')
    })

    it('should normalize fan_only mode correctly', () => {
      const appliance: Appliance = {
        applianceId: 'test-123',
        properties: {
          reported: {
            mode: 'FANONLY',
          },
        },
      } as unknown as Appliance

      const result = normalizeClimateAppliance(appliance)
      expect(result.mode).toBe('fan_only')
    })

    it('should normalize compressor runtime values', () => {
      const appliance: Appliance = {
        applianceId: 'test-123',
        properties: {
          reported: {
            compressorCoolingRuntime: 1000,
            compressorHeatingRuntime: 500,
            totalRuntime: 1500,
            filterRuntime: 300,
          },
        },
      } as unknown as Appliance

      const result = normalizeClimateAppliance(appliance)
      expect(result.compressorCoolingRuntime).toBe(1000)
      expect(result.compressorHeatingRuntime).toBe(500)
      expect(result.totalRuntime).toBe(1500)
      expect(result.filterRuntime).toBe(300)
    })

    it('should normalize advanced states', () => {
      const appliance: Appliance = {
        applianceId: 'test-123',
        properties: {
          reported: {
            fourWayValveState: 'ON',
            evapDefrostState: 'OFF',
            hepaFilterLifeTime: 2000,
          },
        },
      } as unknown as Appliance

      const result = normalizeClimateAppliance(appliance)
      expect(result.fourWayValveState).toBe('on')
      expect(result.evapDefrostState).toBe('off')
      expect(result.hepaFilterLifeTime).toBe(2000)
    })
  })
})

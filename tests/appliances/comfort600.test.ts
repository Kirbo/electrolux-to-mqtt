import { describe, expect, it } from 'vitest'
import { Comfort600Appliance } from '../../src/appliances/comfort600.js'
import type { Appliance, ApplianceInfo, ApplianceStub } from '../../src/types.js'

// Mock data
const mockStub: ApplianceStub = {
  applianceId: 'test-appliance-123',
  applianceName: 'Test AC',
  applianceType: 'PORTABLE_AIR_CONDITIONER',
  created: '2024-01-01T00:00:00Z',
}

const mockInfo: ApplianceInfo = {
  applianceInfo: {
    serialNumber: 'SN123456',
    pnc: '12345678',
    brand: 'Electrolux',
    deviceType: 'PORTABLE_AIR_CONDITIONER',
    model: 'COMFORT600',
    variant: 'A1',
    colour: 'White',
  },
  capabilities: {
    alerts: {
      access: 'read',
      type: 'alert',
      values: {
        ROOM_TEMPERATURE_THERMISTOR_FAULT: {},
        INDOOR_DEFROST_THERMISTOR_FAULT: {},
        DRAIN_PAN_FULL: {},
        COMMUNICATION_FAULT: {},
        DC_MOTOR_FAULT: {},
      },
    },
    applianceState: {
      access: 'read',
      type: 'string',
      values: { OFF: {}, RUNNING: {} },
    },
    executeCommand: {
      access: 'readwrite',
      type: 'string',
      schedulable: true,
      values: { ON: {}, OFF: {} },
    },
    targetTemperatureC: {
      access: 'readwrite',
      default: 16,
      max: 32,
      min: 16,
      step: 1,
      type: 'temperature',
      schedulable: true,
    },
    fanSpeedSetting: {
      access: 'readwrite',
      type: 'string',
      schedulable: true,
      values: { AUTO: {}, LOW: {}, MIDDLE: {}, HIGH: {} },
    },
    fanSpeedState: {
      access: 'read',
      type: 'string',
      values: { HIGH: {}, LOW: {}, MIDDLE: {} },
    },
    mode: {
      access: 'readwrite',
      type: 'string',
      schedulable: true,
      values: {
        AUTO: {},
        COOL: {},
        DRY: {},
        HEAT: {},
        FANONLY: {},
        OFF: { disabled: true },
      },
      triggers: [
        // Fan only mode trigger
        {
          action: {
            fanSpeedSetting: {
              access: 'readwrite',
              type: 'string',
              values: { LOW: {}, MIDDLE: {}, HIGH: {} },
            },
            targetTemperatureC: {
              access: 'readwrite',
              default: 23,
              max: 23,
              min: 23,
              step: 1,
              type: 'temperature',
              disabled: true,
            },
            sleepMode: { disabled: true },
          },
          condition: { operand_1: 'value', operand_2: 'FANONLY', operator: 'eq' },
        },
        // Dry mode trigger
        {
          action: {
            fanSpeedSetting: { access: 'read', type: 'string', values: { LOW: {} } },
            targetTemperatureC: {
              access: 'readwrite',
              default: 23,
              max: 23,
              min: 23,
              step: 1,
              type: 'temperature',
              disabled: true,
            },
            sleepMode: { disabled: true },
          },
          condition: { operand_1: 'value', operand_2: 'DRY', operator: 'eq' },
        },
        // Auto mode trigger
        {
          action: {
            fanSpeedSetting: { access: 'read', type: 'string', values: { AUTO: {} } },
            targetTemperatureC: {
              access: 'readwrite',
              default: 16,
              max: 32,
              min: 16,
              step: 1,
              type: 'temperature',
            },
            sleepMode: { disabled: false },
          },
          condition: { operand_1: 'value', operand_2: 'AUTO', operator: 'eq' },
        },
        // Cool mode trigger
        {
          action: {
            fanSpeedSetting: {
              access: 'readwrite',
              type: 'string',
              values: { AUTO: {}, LOW: {}, MIDDLE: {}, HIGH: {} },
            },
            targetTemperatureC: {
              access: 'readwrite',
              default: 16,
              max: 32,
              min: 16,
              step: 1,
              type: 'temperature',
            },
            sleepMode: { disabled: false },
          },
          condition: { operand_1: 'value', operand_2: 'COOL', operator: 'eq' },
        },
        // Heat mode trigger
        {
          action: {
            fanSpeedSetting: {
              access: 'readwrite',
              type: 'string',
              values: { AUTO: {}, LOW: {}, MIDDLE: {}, HIGH: {} },
            },
            targetTemperatureC: {
              access: 'readwrite',
              default: 16,
              max: 32,
              min: 16,
              step: 1,
              type: 'temperature',
            },
            sleepMode: { disabled: false },
          },
          condition: { operand_1: 'value', operand_2: 'HEAT', operator: 'eq' },
        },
      ],
    },
    networkInterface: {
      linkQualityIndicator: {
        access: 'read',
        type: 'string',
        values: {
          EXCELLENT: {},
          GOOD: {},
          POOR: {},
          UNDEFINED: {},
          VERY_GOOD: {},
          VERY_POOR: {},
        },
        rssi: { access: 'read', type: 'string' },
      },
      swVersion: { access: 'read', type: 'string' },
    },
    sleepMode: {
      access: 'readwrite',
      type: 'string',
      values: { OFF: {}, ON: {} },
    },
    uiLockMode: {
      access: 'readwrite',
      type: 'boolean',
      values: { OFF: {}, ON: {} },
    },
    verticalSwing: {
      access: 'readwrite',
      type: 'string',
      schedulable: true,
      values: { OFF: {}, ON: {} },
    },
    startTime: {
      access: 'readwrite',
      max: 86400,
      min: 0,
      step: 1800,
      type: 'number',
      values: {
        '0': {},
        '1800': {},
        '3600': {},
        '5400': {},
        '7200': {},
        '9000': {},
        '10800': {},
        '12600': {},
        '14400': {},
        '16200': {},
        '18000': {},
        '19800': {},
        '21600': {},
        '23400': {},
        '25200': {},
        '27000': {},
        '28800': {},
        '30600': {},
        '32400': {},
        '34200': {},
        '36000': {},
        '39600': {},
        '43200': {},
        '46800': {},
        '50400': {},
        '54000': {},
        '57600': {},
        '61200': {},
        '64800': {},
        '68400': {},
        '72000': {},
        '75600': {},
        '79200': {},
        '82800': {},
        '86400': {},
      },
    },
    stopTime: {
      access: 'readwrite',
      max: 86400,
      min: 0,
      step: 1800,
      type: 'number',
      values: {
        '0': {},
        '1800': {},
        '3600': {},
        '5400': {},
        '7200': {},
        '9000': {},
        '10800': {},
        '12600': {},
        '14400': {},
        '16200': {},
        '18000': {},
        '19800': {},
        '21600': {},
        '23400': {},
        '25200': {},
        '27000': {},
        '28800': {},
        '30600': {},
        '32400': {},
        '34200': {},
        '36000': {},
        '39600': {},
        '43200': {},
        '46800': {},
        '50400': {},
        '54000': {},
        '57600': {},
        '61200': {},
        '64800': {},
        '68400': {},
        '72000': {},
        '75600': {},
        '79200': {},
        '82800': {},
        '86400': {},
      },
    },
    ambientTemperatureC: { access: 'read', step: 1, type: 'int' },
  },
}

describe('Comfort600Appliance', () => {
  const appliance = new Comfort600Appliance(mockStub, mockInfo)

  describe('Basic Properties', () => {
    it('should return correct appliance ID', () => {
      expect(appliance.getApplianceId()).toBe('test-appliance-123')
    })

    it('should return correct appliance name', () => {
      expect(appliance.getApplianceName()).toBe('Test AC')
    })

    it('should return correct model name', () => {
      expect(appliance.getModelName()).toBe('COMFORT600')
    })

    it('should return correct appliance type', () => {
      expect(appliance.getApplianceType()).toBe('PORTABLE_AIR_CONDITIONER')
    })
  })

  describe('Supported Modes', () => {
    it('should return correct climate modes', () => {
      const modes = appliance.getSupportedModes()
      expect(modes).toContain('off')
      expect(modes).toContain('auto')
      expect(modes).toContain('cool')
      expect(modes).toContain('heat')
      expect(modes).toContain('dry')
      expect(modes).toContain('fan_only')
    })

    it('should return correct fan modes', () => {
      const modes = appliance.getSupportedFanModes()
      expect(modes).toContain('auto')
      expect(modes).toContain('high')
      expect(modes).toContain('medium')
      expect(modes).toContain('low')
    })

    it('should return correct swing modes', () => {
      const modes = appliance.getSupportedSwingModes()
      expect(modes).toContain('on')
      expect(modes).toContain('off')
    })
  })

  describe('Temperature Range', () => {
    it('should return correct temperature range', () => {
      const range = appliance.getTemperatureRange()
      expect(range.min).toBe(16)
      expect(range.max).toBe(32)
      expect(range.initial).toBe(16)
    })

    it('should use default temperature range when capabilities are missing', () => {
      const applianceNoCaps = new Comfort600Appliance(mockStub, mockInfo)
      const range = applianceNoCaps.getTemperatureRange()

      expect(range.min).toBe(16)
      expect(range.max).toBe(32)
      expect(range.initial).toBe(16)
    })
  })

  describe('MQTT Command Transformation', () => {
    it('should transform mode command to API format', () => {
      const apiCommand = appliance.transformMqttCommandToApi({ mode: 'cool' })
      expect(apiCommand.mode).toBe('COOL')
    })

    it('should transform fan_only mode to FANONLY', () => {
      const apiCommand = appliance.transformMqttCommandToApi({ mode: 'fan_only' })
      expect(apiCommand.mode).toBe('FANONLY')
    })

    it('should transform fan mode to API format', () => {
      const apiCommand = appliance.transformMqttCommandToApi({ fanSpeedSetting: 'high' })
      expect(apiCommand.fanSpeedSetting).toBe('HIGH')
    })

    it('should transform medium fan mode to MIDDLE', () => {
      const apiCommand = appliance.transformMqttCommandToApi({ fanSpeedSetting: 'medium' })
      expect(apiCommand.fanSpeedSetting).toBe('MIDDLE')
    })

    it('should transform temperature command to API format', () => {
      const apiCommand = appliance.transformMqttCommandToApi({ targetTemperatureC: 24 })
      expect(apiCommand.targetTemperatureC).toBe(24)
    })

    it('should transform swing mode to API format', () => {
      const apiCommand = appliance.transformMqttCommandToApi({ verticalSwing: 'on' })
      expect(apiCommand.verticalSwing).toBe('ON')
    })

    it('should transform sleep mode to API format', () => {
      const apiCommand = appliance.transformMqttCommandToApi({ sleepMode: 'on' })
      expect(apiCommand.sleepMode).toBe('ON')
    })
  })

  describe('Immediate State Updates', () => {
    it('should turn on appliance when setting mode', () => {
      const updates = appliance.deriveImmediateStateFromCommand({ executeCommand: 'ON' })
      expect(updates).toMatchObject({
        applianceState: 'on',
      })
    })

    it('should turn off appliance when setting mode to OFF', () => {
      const updates = appliance.deriveImmediateStateFromCommand({ executeCommand: 'OFF' })
      expect(updates).toMatchObject({
        applianceState: 'off',
      })
    })

    it('should return null for commands without executeCommand', () => {
      const updates = appliance.deriveImmediateStateFromCommand({ targetTemperatureC: 25 })
      expect(updates).toBeNull()
    })

    it('should return null for fan speed commands', () => {
      const updates = appliance.deriveImmediateStateFromCommand({ fanSpeedSetting: 'HIGH' })
      expect(updates).toBeNull()
    })
  })

  describe('Auto-Discovery Configuration', () => {
    it('should generate valid Home Assistant config', () => {
      const config = appliance.generateAutoDiscoveryConfig('test_prefix')

      expect(config.object_id).toContain('Electrolux')
      expect(config.object_id).toContain('COMFORT600')
      expect(config.modes).toContain('cool')
      expect(config.fan_modes).toContain('auto')
      expect(config.temperature_unit).toBe('C')
      expect(config.min_temp).toBe(16)
      expect(config.max_temp).toBe(32)
    })

    it('should include temperature_state_topic', () => {
      const config = appliance.generateAutoDiscoveryConfig('test_prefix')
      expect(config.temperature_state_topic).toBeDefined()
      expect(config.temperature_state_template).toBeDefined()
    })

    it('should use correct topic prefix', () => {
      const config = appliance.generateAutoDiscoveryConfig('custom_prefix')
      expect(config.mode_state_topic).toContain('custom_prefix')
      expect(config.mode_command_topic).toContain('custom_prefix')
    })
  })

  describe('validateCommand', () => {
    it('should allow fan speed AUTO in cool mode', () => {
      const result = appliance.validateCommand({ fanSpeedSetting: 'auto' }, 'cool')
      expect(result.valid).toBe(true)
    })

    it('should allow fan speed HIGH in cool mode', () => {
      const result = appliance.validateCommand({ fanSpeedSetting: 'high' }, 'cool')
      expect(result.valid).toBe(true)
    })

    it('should allow fan speed HIGH in heat mode', () => {
      const result = appliance.validateCommand({ fanSpeedSetting: 'high' }, 'heat')
      expect(result.valid).toBe(true)
    })

    it('should reject fan speed HIGH in dry mode', () => {
      const result = appliance.validateCommand({ fanSpeedSetting: 'high' }, 'dry')
      expect(result.valid).toBe(false)
      expect(result.valid === false && result.reason).toContain('fan speed')
    })

    it('should reject fan speed AUTO in dry mode', () => {
      const result = appliance.validateCommand({ fanSpeedSetting: 'auto' }, 'dry')
      expect(result.valid).toBe(false)
    })

    it('should reject fan speed HIGH in auto mode', () => {
      const result = appliance.validateCommand({ fanSpeedSetting: 'high' }, 'auto')
      expect(result.valid).toBe(false)
    })

    it('should reject fan speed LOW in dry mode (read-only)', () => {
      // DRY trigger has access: "read" — fan speed is completely read-only
      const result = appliance.validateCommand({ fanSpeedSetting: 'low' }, 'dry')
      expect(result.valid).toBe(false)
      expect(result.valid === false && result.reason).toContain('read-only')
    })

    it('should reject fan speed AUTO in auto mode (read-only)', () => {
      // AUTO trigger has access: "read" — fan speed is completely read-only
      const result = appliance.validateCommand({ fanSpeedSetting: 'auto' }, 'auto')
      expect(result.valid).toBe(false)
      expect(result.valid === false && result.reason).toContain('read-only')
    })

    it('should reject fan speed AUTO in fan_only mode', () => {
      const result = appliance.validateCommand({ fanSpeedSetting: 'auto' }, 'fan_only')
      expect(result.valid).toBe(false)
    })

    it('should allow fan speed HIGH in fan_only mode', () => {
      const result = appliance.validateCommand({ fanSpeedSetting: 'high' }, 'fan_only')
      expect(result.valid).toBe(true)
    })

    it('should allow mode changes without fan speed', () => {
      const result = appliance.validateCommand({ mode: 'dry' }, 'cool')
      expect(result.valid).toBe(true)
    })

    it('should allow temperature changes', () => {
      const result = appliance.validateCommand({ targetTemperatureC: 24 }, 'cool')
      expect(result.valid).toBe(true)
    })

    it('should allow commands when current mode is unknown (off)', () => {
      const result = appliance.validateCommand({ fanSpeedSetting: 'high' }, 'off')
      expect(result.valid).toBe(true)
    })

    it('should validate against the target mode when mode is included in command', () => {
      // Switching to dry mode with high fan speed should fail (dry only allows low)
      const result = appliance.validateCommand({ mode: 'dry', fanSpeedSetting: 'high' }, 'cool')
      expect(result.valid).toBe(false)
    })

    it('should allow valid fan speed with mode change', () => {
      // Switching to fan_only with high fan speed should succeed
      const result = appliance.validateCommand({ mode: 'fan_only', fanSpeedSetting: 'high' }, 'cool')
      expect(result.valid).toBe(true)
    })

    it('should work with appliance that has no mode triggers', () => {
      const infoNoTriggers: ApplianceInfo = {
        ...mockInfo,
        capabilities: {
          ...mockInfo.capabilities,
          mode: {
            access: 'readwrite',
            type: 'string',
            schedulable: true,
            values: { AUTO: {}, COOL: {} },
          },
        },
      }
      const applianceNoTriggers = new Comfort600Appliance(mockStub, infoNoTriggers)
      const result = applianceNoTriggers.validateCommand({ fanSpeedSetting: 'high' }, 'dry')
      expect(result.valid).toBe(true)
    })

    // Temperature validation
    it('should reject temperature changes in fan_only mode (disabled)', () => {
      const result = appliance.validateCommand({ targetTemperatureC: 24 }, 'fan_only')
      expect(result.valid).toBe(false)
      expect(result.valid === false && result.reason).toContain('disabled')
    })

    it('should reject temperature changes in dry mode (disabled)', () => {
      const result = appliance.validateCommand({ targetTemperatureC: 24 }, 'dry')
      expect(result.valid).toBe(false)
      expect(result.valid === false && result.reason).toContain('disabled')
    })

    it('should allow temperature changes in cool mode', () => {
      const result = appliance.validateCommand({ targetTemperatureC: 24 }, 'cool')
      expect(result.valid).toBe(true)
    })

    it('should allow temperature at exact minimum boundary', () => {
      const result = appliance.validateCommand({ targetTemperatureC: 16 }, 'cool')
      expect(result.valid).toBe(true)
    })

    it('should allow temperature at exact maximum boundary', () => {
      const result = appliance.validateCommand({ targetTemperatureC: 32 }, 'cool')
      expect(result.valid).toBe(true)
    })

    it('should reject temperature below mode minimum', () => {
      const result = appliance.validateCommand({ targetTemperatureC: 10 }, 'cool')
      expect(result.valid).toBe(false)
      expect(result.valid === false && result.reason).toContain('below minimum')
    })

    it('should reject temperature above mode maximum', () => {
      const result = appliance.validateCommand({ targetTemperatureC: 40 }, 'cool')
      expect(result.valid).toBe(false)
      expect(result.valid === false && result.reason).toContain('above maximum')
    })

    // Sleep mode validation
    it('should reject sleep mode in fan_only mode (disabled)', () => {
      const result = appliance.validateCommand({ sleepMode: 'on' }, 'fan_only')
      expect(result.valid).toBe(false)
      expect(result.valid === false && result.reason).toContain('sleep mode is disabled')
    })

    it('should reject sleep mode in dry mode (disabled)', () => {
      const result = appliance.validateCommand({ sleepMode: 'on' }, 'dry')
      expect(result.valid).toBe(false)
      expect(result.valid === false && result.reason).toContain('sleep mode is disabled')
    })

    it('should allow sleep mode in cool mode', () => {
      const result = appliance.validateCommand({ sleepMode: 'on' }, 'cool')
      expect(result.valid).toBe(true)
    })

    it('should allow sleep mode in heat mode', () => {
      const result = appliance.validateCommand({ sleepMode: 'on' }, 'heat')
      expect(result.valid).toBe(true)
    })

    // Combined validation
    it('should reject if any field in a combined command is invalid', () => {
      // fan_only: temperature disabled, sleep disabled, but fan speed is fine
      const result = appliance.validateCommand(
        { fanSpeedSetting: 'high', targetTemperatureC: 24, sleepMode: 'on' },
        'fan_only',
      )
      expect(result.valid).toBe(false)
    })
  })

  describe('dynamic capabilities', () => {
    it('should derive supported modes from capabilities', () => {
      const modes = appliance.getSupportedModes()
      expect(modes).toContain('auto')
      expect(modes).toContain('cool')
      expect(modes).toContain('dry')
      expect(modes).toContain('heat')
      expect(modes).toContain('fan_only')
      expect(modes).toContain('off')
    })

    it('should derive supported fan modes from capabilities', () => {
      const fanModes = appliance.getSupportedFanModes()
      expect(fanModes).toContain('auto')
      expect(fanModes).toContain('high')
      expect(fanModes).toContain('medium')
      expect(fanModes).toContain('low')
    })

    it('should derive supported swing modes from capabilities', () => {
      const swingModes = appliance.getSupportedSwingModes()
      expect(swingModes).toContain('on')
      expect(swingModes).toContain('off')
    })

    it('should handle missing mode capabilities gracefully', () => {
      const infoNoModes: ApplianceInfo = {
        ...mockInfo,
        capabilities: {
          ...mockInfo.capabilities,
          mode: undefined as unknown as (typeof mockInfo.capabilities)['mode'],
        },
      }
      const app = new Comfort600Appliance(mockStub, infoNoModes)
      expect(app.getSupportedModes()).toEqual(['off'])
    })

    it('should handle missing fan speed capabilities gracefully', () => {
      const infoNoFan: ApplianceInfo = {
        ...mockInfo,
        capabilities: {
          ...mockInfo.capabilities,
          fanSpeedSetting: undefined as unknown as (typeof mockInfo.capabilities)['fanSpeedSetting'],
        },
      }
      const app = new Comfort600Appliance(mockStub, infoNoFan)
      expect(app.getSupportedFanModes()).toEqual(['auto'])
    })

    it('should handle missing swing capabilities gracefully', () => {
      const infoNoSwing: ApplianceInfo = {
        ...mockInfo,
        capabilities: {
          ...mockInfo.capabilities,
          verticalSwing: undefined as unknown as (typeof mockInfo.capabilities)['verticalSwing'],
        },
      }
      const app = new Comfort600Appliance(mockStub, infoNoSwing)
      expect(app.getSupportedSwingModes()).toEqual(['off'])
    })

    it('should ignore unknown API mode values', () => {
      const infoExtra: ApplianceInfo = {
        ...mockInfo,
        capabilities: {
          ...mockInfo.capabilities,
          mode: {
            ...mockInfo.capabilities.mode,
            values: { ...mockInfo.capabilities.mode.values, TURBO: {} },
          },
        },
      }
      const app = new Comfort600Appliance(mockStub, infoExtra)
      const modes = app.getSupportedModes()
      expect(modes).not.toContain('turbo')
      expect(modes).toContain('cool')
    })
  })

  describe('normalizeState', () => {
    it('should normalize raw API state using climate appliance normalizer', () => {
      const rawState: Appliance = {
        applianceId: 'test-appliance-123',
        connectionState: 'Connected',
        status: 'enabled',
        properties: {
          reported: {
            applianceState: 'RUNNING',
            mode: 'COOL',
            fanSpeedSetting: 'AUTO',
            targetTemperatureC: 24,
            ambientTemperatureC: 26,
            verticalSwing: 'ON',
            sleepMode: 'OFF',
            uiLockMode: false,
            Workmode_1: 1,
            WorkMode: 1,
          },
        },
      }

      const normalized = appliance.normalizeState(rawState)

      expect(normalized).toBeDefined()
      expect(normalized.applianceId).toBe('test-appliance-123')
      expect(normalized.targetTemperatureC).toBe(24)
    })
  })
})

import { describe, expect, it } from 'vitest'
import { Comfort600Appliance } from '../../src/appliances/comfort600.js'
import type { ApplianceInfo, ApplianceStub } from '../../src/types.js'

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
      expect(apiCommand.verticalSwing).toBe('on')
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
})

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

const mockInfo = {
  applianceInfo: {
    applianceId: 'test-appliance-123',
    applianceName: 'Test AC',
    brand: 'Electrolux',
    colour: 'White',
    deviceType: 'PORTABLE_AIR_CONDITIONER',
    model: 'COMFORT600',
    serialNumber: 'SN123456',
    variant: 'A1',
  },
  capabilities: {
    mode: {
      values: {
        AUTO: {},
        COOL: {},
        HEAT: {},
        DRY: {},
        FANONLY: {},
      },
    },
    fanSpeedSetting: {
      values: {
        AUTO: {},
        HIGH: {},
        MIDDLE: {},
        LOW: {},
      },
    },
    verticalSwing: {
      values: {
        ON: {},
        OFF: {},
      },
    },
    targetTemperatureC: {
      min: 16,
      max: 30,
      default: 22,
    },
  },
  connectionState: 'connected',
  state: {
    reported: {
      applianceState: 'RUNNING',
      mode: 'COOL',
      fanSpeedSetting: 'AUTO',
      targetTemperatureC: 22,
      ambientTemperatureC: 25,
      verticalSwing: 'ON',
    },
  },
} as unknown as ApplianceInfo

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
      expect(range.max).toBe(30)
      expect(range.initial).toBe(22)
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
      expect(config.max_temp).toBe(30)
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

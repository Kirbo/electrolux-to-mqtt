import { describe, expect, it } from 'vitest'
import { BaseAppliance } from '../../src/appliances/base.js'
import type { HAClimateDiscoveryConfig, HAClimateMode, HAFanMode, HASwingMode } from '../../src/types/homeassistant.js'
import type { NormalizedState } from '../../src/types/normalized.js'
import type { Appliance, ApplianceInfo, ApplianceStub } from '../../src/types.js'

// Create a concrete test implementation of BaseAppliance
class TestAppliance extends BaseAppliance {
  normalizeState(_rawState: Appliance): NormalizedState {
    // Simplified for testing
    return {} as NormalizedState
  }

  transformMqttCommandToApi(rawCommand: Partial<NormalizedState>): Record<string, unknown> {
    const apiCommand: Record<string, unknown> = {}

    if (rawCommand.applianceState !== undefined) {
      apiCommand.applianceState = rawCommand.applianceState
    }
    if (rawCommand.mode !== undefined) {
      apiCommand.mode = rawCommand.mode
    }
    if (rawCommand.targetTemperatureC !== undefined) {
      apiCommand.targetTemperatureC = rawCommand.targetTemperatureC
    }

    return apiCommand
  }

  generateAutoDiscoveryConfig(topicPrefix: string): HAClimateDiscoveryConfig {
    const info = this.getApplianceInfo()
    return {
      name: this.getApplianceName(),
      object_id: this.getApplianceId(),
      uniq_id: this.getApplianceId(),
      device: {
        identifiers: [this.getApplianceId()],
        name: this.getApplianceName(),
        manufacturer: info.applianceInfo.brand,
        model: info.applianceInfo.model,
      },
      availability_topic: `${topicPrefix}${this.getApplianceId()}/availability`,
      availability_template: '{{ value_json.state }}',
      payload_available: 'connected',
      payload_not_available: 'disconnected',
      json_attributes_topic: `${topicPrefix}${this.getApplianceId()}/attributes`,
      mode_state_topic: `${topicPrefix}${this.getApplianceId()}/state`,
      mode_state_template: '{{ value_json.mode }}',
      mode_command_topic: `${topicPrefix}${this.getApplianceId()}/set`,
      mode_command_template: '{{ value }}',
      precision: 1,
      temperature_unit: 'C',
      temperature_state_topic: `${topicPrefix}${this.getApplianceId()}/state`,
      temperature_state_template: '{{ value_json.targetTemperatureC }}',
      temperature_command_topic: `${topicPrefix}${this.getApplianceId()}/set`,
      temperature_command_template: '{{ value }}',
      current_temperature_topic: `${topicPrefix}${this.getApplianceId()}/state`,
      current_temperature_template: '{{ value_json.ambientTemperatureC }}',
      fan_mode_state_topic: `${topicPrefix}${this.getApplianceId()}/state`,
      fan_mode_state_template: '{{ value_json.fanSpeed }}',
      fan_mode_command_topic: `${topicPrefix}${this.getApplianceId()}/set`,
      fan_mode_command_template: '{{ value }}',
      swing_mode_state_topic: `${topicPrefix}${this.getApplianceId()}/state`,
      swing_mode_state_template: '{{ value_json.horizontalSwing }}',
      swing_mode_command_topic: `${topicPrefix}${this.getApplianceId()}/set`,
      swing_mode_command_template: '{{ value }}',
      modes: this.getSupportedModes(),
      fan_modes: this.getSupportedFanModes(),
      swing_modes: this.getSupportedSwingModes(),
      min_temp: this.getTemperatureRange().min,
      max_temp: this.getTemperatureRange().max,
      initial: this.getTemperatureRange().initial,
    }
  }

  getSupportedModes(): HAClimateMode[] {
    return ['off', 'cool', 'heat', 'auto']
  }

  getSupportedFanModes(): HAFanMode[] {
    return ['auto', 'low', 'medium', 'high']
  }

  getSupportedSwingModes(): HASwingMode[] {
    return ['off', 'on']
  }

  getTemperatureRange() {
    return { min: 16, max: 30, initial: 22 }
  }

  getModelName() {
    return 'TestModel'
  }
}

const mockStub: ApplianceStub = {
  applianceId: 'test-base-123',
  applianceName: 'Test Base Appliance',
  applianceType: 'TEST_TYPE',
  created: '2024-01-01T00:00:00Z',
}

const mockInfo: ApplianceInfo = {
  applianceInfo: {
    serialNumber: 'SN-TEST-123',
    pnc: 'PNC-TEST-456',
    brand: 'TestBrand',
    deviceType: 'TEST_TYPE',
    model: 'TestModel',
    variant: 'V1',
    colour: 'Black',
  },
  capabilities: {
    alerts: { access: 'read', type: 'alert', values: {} },
    ambientTemperatureC: { access: 'read', step: 1, type: 'int' },
    applianceState: { access: 'read', type: 'string', values: {} },
    executeCommand: { access: 'readwrite', schedulable: true, type: 'string', values: {} },
    fanSpeedSetting: { access: 'readwrite', schedulable: true, type: 'string', values: {} },
    fanSpeedState: { access: 'read', type: 'string', values: {} },
    mode: { access: 'readwrite', schedulable: true, triggers: [], type: 'string', values: {} },
    networkInterface: {
      linkQualityIndicator: {
        access: 'read',
        rssi: { access: 'read', type: 'string' },
        type: 'string',
        values: {},
      },
      swVersion: { access: 'read', type: 'string' },
    },
    sleepMode: { access: 'readwrite', type: 'string', values: {} },
    startTime: { access: 'readwrite', max: 1439, min: 0, step: 1, type: 'number', values: {} },
    stopTime: { access: 'readwrite', max: 1439, min: 0, step: 1, type: 'number', values: {} },
    targetTemperatureC: {
      access: 'readwrite',
      default: 22,
      max: 30,
      min: 16,
      schedulable: true,
      step: 1,
      type: 'temperature',
    },
    uiLockMode: { access: 'readwrite', type: 'boolean', values: {} },
    verticalSwing: { access: 'readwrite', schedulable: true, type: 'string', values: {} },
  },
}

const mockRawState: Appliance = {
  applianceId: 'test-base-123',
  connectionState: 'Connected',
  properties: {
    reported: {
      applianceState: 'on',
      mode: 'cool',
      targetTemperatureC: 22,
      ambientTemperatureC: 25,
      fanSpeedSetting: 'auto',
      verticalSwing: 'on',
      dataModelVersion: '',
      deviceId: '',
      networkInterface: {
        linkQualityIndicator: 'EXCELLENT',
        rssi: 0,
      },
    },
  },
  status: 'enabled',
}

describe('BaseAppliance', () => {
  describe('constructor', () => {
    it('should initialize with stub and info', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)

      expect(appliance).toBeDefined()
      expect(appliance.getApplianceId()).toBe(mockStub.applianceId)
      expect(appliance.getApplianceType()).toBe(mockStub.applianceType)
    })

    it('should store appliance info correctly', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)
      const info = appliance.getApplianceInfo()

      expect(info).toBeDefined()
      expect(info.applianceInfo.serialNumber).toBe('SN-TEST-123')
      expect(info.applianceInfo.brand).toBe('TestBrand')
      expect(info.applianceInfo.model).toBe('TestModel')
    })
  })

  describe('getApplianceId', () => {
    it('should return the correct appliance ID', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)

      expect(appliance.getApplianceId()).toBe('test-base-123')
    })
  })

  describe('getApplianceType', () => {
    it('should return the correct appliance type', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)

      expect(appliance.getApplianceType()).toBe('TEST_TYPE')
    })
  })

  describe('getApplianceInfo', () => {
    it('should return complete appliance info', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)
      const info = appliance.getApplianceInfo()

      expect(info).toEqual(mockInfo)
      expect(info.applianceInfo.serialNumber).toBe('SN-TEST-123')
      expect(info.applianceInfo.deviceType).toBe('TEST_TYPE')
    })
  })

  describe('normalizeState', () => {
    it('should normalize raw state correctly', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)
      const normalized = appliance.normalizeState(mockRawState)

      // Test appliance returns empty normalized state
      expect(normalized).toBeDefined()
    })
  })

  describe('transformMqttCommandToApi', () => {
    it('should transform applianceState command', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)
      const command = { applianceState: 'on' as const }
      const apiCommand = appliance.transformMqttCommandToApi(command)

      expect(apiCommand.applianceState).toBe('on')
    })

    it('should transform mode command', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)
      const command = { mode: 'heat' as const }
      const apiCommand = appliance.transformMqttCommandToApi(command)

      expect(apiCommand.mode).toBe('heat')
    })

    it('should transform temperature command', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)
      const command = { targetTemperatureC: 24 }
      const apiCommand = appliance.transformMqttCommandToApi(command)

      expect(apiCommand.targetTemperatureC).toBe(24)
    })
  })

  describe('deriveImmediateStateFromCommand', () => {
    it('should return null by default', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)
      const result = appliance.deriveImmediateStateFromCommand({ mode: 'COOL' })

      expect(result).toBeNull()
    })
  })

  describe('generateAutoDiscoveryConfig', () => {
    it('should generate valid auto-discovery config', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)
      const config = appliance.generateAutoDiscoveryConfig('test_')

      expect(config).toBeDefined()
      expect(config.name).toBe('Test Base Appliance')
      expect(config.uniq_id).toBe('test-base-123')
      expect(config.device.identifiers).toContain('test-base-123')
      expect(config.device.manufacturer).toBe('TestBrand')
    })

    it('should include device information in config', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)
      const config = appliance.generateAutoDiscoveryConfig('test_')

      expect(config.device).toBeDefined()
      expect(config.device.name).toBe('Test Base Appliance')
      expect(config.device.model).toBe('TestModel')
    })
  })
})

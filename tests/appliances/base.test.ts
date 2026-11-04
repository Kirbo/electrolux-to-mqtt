import { describe, expect, it } from 'vitest'
import { BaseAppliance, type DiscoveryContext } from '#/appliances/base.js'
import type { HAClimateMode, HADeviceDiscoveryConfig, HAFanMode, HASwingMode } from '#/types/homeassistant.js'
import type { NormalizedState } from '#/types/normalized.js'
import type { Appliance, ApplianceInfo, ApplianceStub } from '#/types.js'

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

  generateAutoDiscoveryConfig(context: DiscoveryContext): HADeviceDiscoveryConfig {
    const info = this.getApplianceInfo()
    const stateTopic = `${context.topicPrefix}${this.getApplianceId()}/state`
    return {
      device: {
        identifiers: [this.getApplianceId()],
        name: this.getApplianceName(),
        manufacturer: info.applianceInfo.brand,
        model: info.applianceInfo.model,
      },
      origin: context.origin,
      availability: [
        { topic: context.availabilityTopic, payload_available: 'online', payload_not_available: 'offline' },
      ],
      availability_mode: 'all',
      components: {
        temperature: {
          platform: 'sensor',
          unique_id: `${this.getApplianceId()}_temperature`,
          name: 'Temperature',
          state_topic: stateTopic,
          value_template: '{{ value_json.ambientTemperatureC }}',
        },
      },
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
      applianceState: 'running',
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

  describe('validateCommand', () => {
    it('should return valid by default', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)
      const result = appliance.validateCommand({ fanSpeedSetting: 'high' }, 'cool')

      expect(result).toEqual({ valid: true })
    })
  })

  describe('generateAutoDiscoveryConfig', () => {
    const context = {
      topicPrefix: 'test_',
      availabilityTopic: 'test_status',
      origin: { name: 'e2m', sw_version: '1', support_url: 'https://example.com' },
    }

    it('should generate a device-based discovery config from the context', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)
      const config = appliance.generateAutoDiscoveryConfig(context)

      expect(config.origin).toEqual(context.origin)
      expect(config.availability[0]?.topic).toBe('test_status')
      expect(config.components.temperature).toMatchObject({
        platform: 'sensor',
        unique_id: 'test-base-123_temperature',
      })
    })

    it('should include device information in config', () => {
      const appliance = new TestAppliance(mockStub, mockInfo)
      const config = appliance.generateAutoDiscoveryConfig(context)

      expect(config.device).toEqual({
        identifiers: ['test-base-123'],
        name: 'Test Base Appliance',
        manufacturer: 'TestBrand',
        model: 'TestModel',
      })
    })
  })
})

import { describe, expect, it } from 'vitest'
import { Comfort600Appliance } from '../../src/appliances/comfort600.js'
import { ApplianceFactory } from '../../src/appliances/factory.js'
import type { ApplianceInfo, ApplianceStub } from '../../src/types.js'

const mockStub: ApplianceStub = {
  applianceId: 'test-123',
  applianceName: 'Test Device',
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

describe('ApplianceFactory', () => {
  describe('create', () => {
    it('should create Comfort600Appliance for COMFORT600 model', () => {
      const appliance = ApplianceFactory.create(mockStub, mockInfo)
      expect(appliance).toBeInstanceOf(Comfort600Appliance)
    })

    it('should return Comfort600 as fallback for unknown device type', () => {
      const unknownStub = { ...mockStub, applianceType: 'UNKNOWN_TYPE' }
      const unknownInfo = {
        ...mockInfo,
        applianceInfo: { ...mockInfo.applianceInfo, deviceType: 'UNKNOWN_TYPE' },
      } as ApplianceInfo

      const appliance = ApplianceFactory.create(unknownStub, unknownInfo)
      expect(appliance).toBeInstanceOf(Comfort600Appliance)
    })

    it('should return Comfort600 as fallback for unknown model', () => {
      const unknownModelInfo = {
        ...mockInfo,
        applianceInfo: { ...mockInfo.applianceInfo, model: 'UNKNOWN_MODEL' },
      } as ApplianceInfo

      const appliance = ApplianceFactory.create(mockStub, unknownModelInfo)
      expect(appliance).toBeInstanceOf(Comfort600Appliance)
    })

    it('should match PORTABLE_AIR_CONDITIONER with AZUL variant', () => {
      const azulInfo = {
        ...mockInfo,
        applianceInfo: {
          ...mockInfo.applianceInfo,
          model: 'SOME_OTHER_MODEL',
          deviceType: 'PORTABLE_AIR_CONDITIONER',
          variant: 'AZUL-123',
        },
      } as ApplianceInfo

      const appliance = ApplianceFactory.create(mockStub, azulInfo)
      expect(appliance).toBeInstanceOf(Comfort600Appliance)
    })

    it('should match device without AZUL variant and use fallback', () => {
      const nonAzulInfo = {
        ...mockInfo,
        applianceInfo: {
          ...mockInfo.applianceInfo,
          model: 'OTHER_MODEL',
          deviceType: 'PORTABLE_AIR_CONDITIONER',
          variant: 'V1',
        },
      } as ApplianceInfo

      const appliance = ApplianceFactory.create(mockStub, nonAzulInfo)
      expect(appliance).toBeInstanceOf(Comfort600Appliance)
    })

    it('should handle devices with no variant', () => {
      const noVariantInfo = {
        ...mockInfo,
        applianceInfo: {
          ...mockInfo.applianceInfo,
          model: 'GENERIC_MODEL',
          variant: '',
        },
      } as ApplianceInfo

      const appliance = ApplianceFactory.create(mockStub, noVariantInfo)
      expect(appliance).toBeInstanceOf(Comfort600Appliance)
    })
  })
})

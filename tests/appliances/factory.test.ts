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

const mockInfo = {
  applianceInfo: {
    applianceId: 'test-123',
    applianceName: 'Test Device',
    brand: 'Electrolux',
    colour: 'White',
    deviceType: 'PORTABLE_AIR_CONDITIONER',
    model: 'COMFORT600',
    serialNumber: 'SN123',
    variant: 'A1',
  },
  capabilities: {
    mode: { values: { COOL: {}, HEAT: {} } },
    fanSpeedSetting: { values: { AUTO: {}, HIGH: {} } },
    verticalSwing: { values: { ON: {}, OFF: {} } },
    targetTemperatureC: { min: 16, max: 30, default: 22 },
  },
  connectionState: 'connected',
  state: { reported: {} },
} as unknown as ApplianceInfo

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
  })
})

/**
 * Example API responses from Electrolux API
 * These are used for mocking in tests and can be compared against real API responses
 */

import type { Appliance, ApplianceInfo, ApplianceStub } from '../../src/types.js'

export const mockAppliancesResponse: ApplianceStub[] = [
  {
    applianceId: 'test-appliance-123',
    applianceName: 'Living Room AC',
    applianceType: 'AIR_CONDITIONER',
    created: '2024-01-15T10:30:00Z',
  },
  {
    applianceId: 'test-appliance-456',
    applianceName: 'Bedroom AC',
    applianceType: 'AIR_CONDITIONER',
    created: '2024-01-20T14:20:00Z',
  },
]

export const mockApplianceStateResponse: Appliance = {
  applianceId: 'test-appliance-123',
  connectionState: 'Connected',
  status: 'enabled',
  properties: {
    reported: {
      $version: 1,
      ambientTemperatureC: 24,
      ambientTemperatureF: 75,
      applianceData: {
        elc: 'ELC123456',
        mac: '00:11:22:33:44:55',
        pnc: 'PNC987654',
        sn: 'SN123456789',
      },
      applianceState: 'on',
      capabilities: {
        cooling: true,
        heating: true,
        fanOnly: true,
      },
      compressorCoolingRuntime: 12500,
      compressorHeatingRuntime: 8200,
      compressorState: 'on',
      dataModelVersion: '1.0.0',
      deviceId: 'device-123',
      evapDefrostState: 'off',
      fanSpeedSetting: 'auto',
      filterRuntime: 5000,
      filterState: 'clean',
      fourWayValveState: 'off',
      hepaFilterLifeTime: 8000,
      logE: 0,
      logW: 0,
      mode: 'cool',
      networkInterface: {
        linkQualityIndicator: 'EXCELLENT',
        rssi: -45,
      },
      schedulerMode: 'off',
      schedulerSession: 'off',
      sleepMode: 'off',
      startTime: 0,
      stopTime: 0,
      targetTemperatureC: 22,
      tasks: {},
      temperatureRepresentation: 'celsius',
      TimeZoneDaylightRule: null,
      TimeZoneStandardName: 'UTC',
      totalRuntime: 20700,
      uiLockMode: false,
      upgradeState: 'idle',
      verticalSwing: 'on',
      VmNo_MCU: 'v1.2.3',
      VmNo_NIU: 'v2.3.4',
    },
  },
}

export const mockApplianceStateOffResponse: Appliance = {
  ...mockApplianceStateResponse,
  properties: {
    reported: {
      ...mockApplianceStateResponse.properties.reported,
      applianceState: 'off',
      mode: 'off',
      compressorState: 'off',
    },
  },
}

export const mockApplianceInfoResponse: ApplianceInfo = {
  applianceInfo: {
    serialNumber: 'SN123456789',
    pnc: 'PNC987654',
    brand: 'Electrolux',
    deviceType: 'AIR_CONDITIONER',
    model: 'EACM-12',
    variant: 'Standard',
    colour: 'White',
  },
  capabilities: {
    alerts: {
      access: 'read',
      type: 'alert',
      values: {},
    },
    ambientTemperatureC: {
      access: 'read',
      step: 1,
      type: 'int',
    },
    applianceState: {
      access: 'read',
      type: 'string',
      values: {},
    },
    executeCommand: {
      access: 'readwrite',
      schedulable: true,
      type: 'string',
      values: {},
    },
    fanSpeedSetting: {
      access: 'readwrite',
      schedulable: true,
      type: 'string',
      values: { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' },
    },
    fanSpeedState: {
      access: 'read',
      type: 'string',
      values: {},
    },
    mode: {
      access: 'readwrite',
      schedulable: true,
      triggers: [],
      type: 'string',
      values: { cool: 'Cool', heat: 'Heat', auto: 'Auto', dry: 'Dry', fanonly: 'Fan Only' },
    },
    networkInterface: {
      linkQualityIndicator: {
        access: 'read',
        rssi: {
          access: 'read',
          type: 'string',
        },
        type: 'string',
        values: {},
      },
      swVersion: {
        access: 'read',
        type: 'string',
      },
    },
    sleepMode: {
      access: 'readwrite',
      type: 'string',
      values: { on: 'On', off: 'Off' },
    },
    startTime: {
      access: 'readwrite',
      max: 1439,
      min: 0,
      step: 1,
      type: 'number',
      values: {},
    },
    stopTime: {
      access: 'readwrite',
      max: 1439,
      min: 0,
      step: 1,
      type: 'number',
      values: {},
    },
    targetTemperatureC: {
      access: 'readwrite',
      default: 22,
      max: 30,
      min: 16,
      schedulable: true,
      step: 1,
      type: 'temperature',
    },
    uiLockMode: {
      access: 'readwrite',
      type: 'boolean',
      values: {},
    },
    verticalSwing: {
      access: 'readwrite',
      schedulable: true,
      type: 'string',
      values: { on: 'On', off: 'Off' },
    },
  },
}

export const mockCsrfTokenResponse = {
  headers: {
    'x-csrf-token': 'mock-csrf-token-12345',
    'set-cookie': ['_csrfSecret=mock-csrf-secret-67890; Path=/; HttpOnly'],
  },
}

export const mockLoginResponse = {
  status: 200,
  data: {
    redirectUrl:
      'https://developer.electrolux.one/generateToken?code=mock-auth-code-abcdef&state=electrolux-mqtt-client',
  },
}

export const mockTokenExchangeResponse = {
  status: 200,
  headers: {
    'set-cookie': [
      'accessToken=s%3AeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3MzczNTEwMDAsImlhdCI6MTczNzI2NDYwMH0.mock-signature; Path=/; HttpOnly',
      'refreshToken=s%3Amock-refresh-token-xyz123; Path=/; HttpOnly',
    ],
  },
}

export const mockTokenRefreshResponse = {
  data: {
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE3MzczNTEwMDAsImlhdCI6MTczNzI2NDYwMH0.new-signature',
    refreshToken: 'new-refresh-token-xyz456',
  },
}

export const mockCommandResponse = {
  status: 200,
  data: {
    status: 'OK',
  },
}

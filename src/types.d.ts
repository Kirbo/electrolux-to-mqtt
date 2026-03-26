export type ApplianceStub = {
  applianceId: string
  applianceName: string
  applianceType: string
  created: string
}

export type Appliance = {
  applianceId: string
  connectionState: 'Connected' | 'Disconnected'
  status: 'enabled' | 'disabled'
  properties: {
    reported: {
      $version?: number
      ambientTemperatureC?: number | null
      ambientTemperatureF?: number | null
      applianceData?: {
        elc: string
        mac: string
        pnc: string
        sn: string
      } | null
      applianceState: 'on' | 'off' | 'running'
      capabilities?: Record<string, unknown>
      compressorCoolingRuntime?: number
      compressorHeatingRuntime?: number
      compressorState?: 'on' | 'off'
      dataModelVersion: string
      deviceId: string
      evapDefrostState?: 'on' | 'off' | null
      fanSpeedSetting?: 'low' | 'medium' | 'middle' | 'high' | 'auto'
      filterRuntime?: number
      filterState?: 'clean' | 'dirty' | 'good'
      fourWayValveState?: 'on' | 'off' | null
      hepaFilterLifeTime?: number | null
      logE?: number | null
      logW?: number | null
      mode?: 'cool' | 'heat' | 'fanonly' | 'dry' | 'auto' | 'off'
      networkInterface: {
        linkQualityIndicator: 'EXCELLENT' | 'VERY_GOOD' | 'GOOD' | 'POOR' | 'VERY_POOR' | 'UNDEFINED'
        rssi: number
      }
      schedulerMode?: 'on' | 'off' | null
      schedulerSession?: 'on' | 'off' | null
      sleepMode?: 'on' | 'off'
      startTime?: number
      stopTime?: number
      targetTemperatureC?: number
      tasks?: Record<string, unknown>
      temperatureRepresentation?: 'celsius' | 'fahrenheit'
      TimeZoneDaylightRule?: string | null
      TimeZoneStandardName?: string | null
      totalRuntime?: number
      uiLockMode?: boolean
      upgradeState?: 'idle' | 'upgrading' | null
      verticalSwing?: 'on' | 'off'
      VmNo_MCU?: string | null
      VmNo_NIU?: string | null
    }
  }
}

export type ApplianceInfo = {
  applianceInfo: {
    serialNumber: string
    pnc?: string
    brand: string
    deviceType: string
    model: string
    variant: string
    colour: string
  }
  capabilities: {
    alerts?: {
      access: 'read'
      type: 'alert'
      values: Record<string, unknown>
    }
    ambientTemperatureC?: {
      access: 'read'
      step: number
      type: 'int'
    }
    applianceState?: {
      access: 'read'
      type: 'string'
      values: Record<string, unknown>
    }
    executeCommand?: {
      access: 'readwrite'
      schedulable: boolean
      type: 'string'
      values: Record<string, unknown>
    }
    fanSpeedSetting?: {
      access: 'readwrite'
      schedulable: boolean
      type: 'string'
      values: Record<string, unknown>
    }
    fanSpeedState?: {
      access: 'read'
      type: 'string'
      values: Record<string, unknown>
    }
    mode?: {
      access: 'readwrite'
      schedulable: boolean
      triggers?: Array<{
        action: Record<string, unknown>
        condition: {
          operand_1: string
          operand_2: string
          operator: string
        }
      }>
      type: 'string'
      values: Record<string, unknown>
    }
    networkInterface: {
      linkQualityIndicator: {
        access: 'read'
        rssi: {
          access: 'read'
          type: 'string'
        }
        type: 'string'
        values: Record<string, unknown>
      }
      swVersion: {
        access: 'read'
        type: 'string'
      }
    }
    sleepMode?: {
      access: 'readwrite'
      type: 'string'
      values: Record<string, unknown>
    }
    startTime?: {
      access: 'readwrite'
      max: number
      min: number
      step: number
      type: 'number'
      values: Record<string, unknown>
    }
    stopTime?: {
      access: 'readwrite'
      max: number
      min: number
      step: number
      type: 'number'
      values: Record<string, unknown>
    }
    targetTemperatureC?: {
      access: 'readwrite'
      default: number
      max: number
      min: number
      schedulable: boolean
      step: number
      type: 'temperature'
    }
    uiLockMode?: {
      access: 'readwrite'
      type: 'boolean'
      values: Record<string, unknown>
    }
    verticalSwing?: {
      access: 'readwrite'
      schedulable: boolean
      type: 'string'
      values: Record<string, unknown>
    }
  }
}

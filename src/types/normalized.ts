/**
 * Normalized state types
 * These represent the standardized format used throughout the application
 * after normalizing from the Electrolux API format
 */

export type OnOffState = 'on' | 'off'
export type OnOffNullableState = 'on' | 'off' | null
export type UpgradeState = 'idle' | 'upgrading' | null
export type LinkQuality = 'excellent' | 'good' | 'fair' | 'poor'
export type FilterState = 'clean' | 'dirty'
export type TemperatureUnit = 'celsius' | 'fahrenheit'
export type ConnectionState = 'connected' | 'disconnected'
export type EnabledState = 'enabled' | 'disabled'

/**
 * Normalized climate mode (matches Home Assistant)
 */
export type NormalizedClimateMode = 'cool' | 'heat' | 'fan_only' | 'dry' | 'auto' | 'off'

/**
 * Normalized fan mode (matches Home Assistant)
 */
export type NormalizedFanMode = 'low' | 'medium' | 'high' | 'auto'

/**
 * Normalized appliance state
 * This is the standardized format used for MQTT publishing and internal state management
 */
export interface NormalizedState {
  applianceId: string
  status: EnabledState
  applianceState: OnOffState
  connectionState: ConnectionState

  // Climate control
  mode: NormalizedClimateMode
  targetTemperatureC: number
  ambientTemperatureC: number | null
  ambientTemperatureF: number | null
  temperatureRepresentation: TemperatureUnit

  // Fan control
  fanSpeedSetting: NormalizedFanMode
  verticalSwing: OnOffState
  sleepMode: OnOffState

  // Device information
  deviceId: string
  dataModelVersion: string
  version: number
  applianceData: {
    elc: string
    mac: string
    pnc: string
    sn: string
  } | null

  // Network
  networkInterface: {
    linkQualityIndicator: LinkQuality
    rssi: number
  }

  // Status information
  compressorState: OnOffState
  compressorCoolingRuntime: number
  compressorHeatingRuntime: number
  totalRuntime: number
  filterState: FilterState
  filterRuntime: number
  hepaFilterLifeTime: number | null

  // Advanced states
  fourWayValveState: OnOffNullableState
  evapDefrostState: OnOffNullableState
  upgradeState: UpgradeState

  // Scheduler
  schedulerMode: OnOffNullableState
  schedulerSession: OnOffNullableState
  startTime: number
  stopTime: number

  // UI
  uiLockMode: boolean

  // Capabilities and diagnostics
  capabilities: Record<string, unknown>
  tasks: Record<string, unknown>
  logE: number | null
  logW: number | null

  // Timezone
  TimeZoneDaylightRule: string | null
  TimeZoneStandardName: string | null

  // Firmware versions
  VmNo_MCU: string | null
  VmNo_NIU: string | null
}

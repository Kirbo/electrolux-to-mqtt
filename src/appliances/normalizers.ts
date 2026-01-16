import type {
  ConnectionState,
  EnabledState,
  FilterState,
  LinkQuality,
  NormalizedClimateMode,
  NormalizedFanMode,
  NormalizedState,
  OnOffNullableState,
  OnOffState,
  TemperatureUnit,
  UpgradeState,
} from '../types/normalized.js'
import type { Appliance } from '../types.js'

/**
 * Utility functions for normalizing Electrolux API data to standard format
 */

/**
 * Normalize a string to lowercase
 */
export function toLowercase<T extends string>(value: T | undefined | null): Lowercase<T> | null {
  return (value?.toLowerCase() as Lowercase<T>) ?? null
}

/**
 * Normalize "running" to "on" for appliance state
 */
export function normalizeApplianceState(state: string | undefined): OnOffState {
  const normalized = state?.toLowerCase()
  return normalized === 'running' ? 'on' : (normalized as OnOffState)
}

/**
 * Normalize connection state from API format to standard format
 */
export function normalizeConnectionState(state: string | undefined): ConnectionState {
  return (state?.toLowerCase() as ConnectionState) ?? 'disconnected'
}

/**
 * Normalize climate mode, handling the special "fanonly" case
 */
export function normalizeClimateMode(mode: string | undefined): NormalizedClimateMode {
  const normalized = mode?.toLowerCase()
  return (normalized === 'fanonly' ? 'fan_only' : normalized) as NormalizedClimateMode
}

/**
 * Normalize fan speed, handling the special "middle" to "medium" mapping
 */
export function normalizeFanSpeed(speed: string | undefined): NormalizedFanMode {
  const normalized = speed?.toLowerCase()
  return (normalized === 'middle' ? 'medium' : normalized) as NormalizedFanMode
}

/**
 * Denormalize fan speed back to API format (medium → MIDDLE)
 */
export function denormalizeFanSpeed(speed: string | undefined): string {
  const lower = speed?.toLowerCase()
  return ['medium', 'middle'].includes(lower ?? '') ? 'MIDDLE' : (speed?.toUpperCase() ?? '')
}

/**
 * Denormalize climate mode back to API format (fan_only → FANONLY)
 */
export function denormalizeClimateMode(mode: string | undefined): string {
  return mode === 'fan_only' ? 'FANONLY' : (mode?.toUpperCase() ?? '')
}

/**
 * Extract the reported properties from raw appliance state
 * Handles both nested (properties.reported) and flat structure
 */
export function extractReportedState(rawState: Appliance): Appliance['properties']['reported'] {
  return rawState?.properties?.reported || (rawState as unknown as Appliance['properties']['reported'])
}

/**
 * Base normalization for fields common to ALL Electrolux appliances
 * This handles universal fields like identity, network, device info, etc.
 */
export function normalizeBaseFields(rawState: Appliance): Partial<NormalizedState> {
  const reported = extractReportedState(rawState)

  return {
    // Identity - universal
    applianceId: rawState.applianceId,
    status: toLowercase(rawState.status) as EnabledState,
    connectionState: normalizeConnectionState(rawState.connectionState),
    applianceState: normalizeApplianceState(reported.applianceState),

    // Device information - universal
    deviceId: reported.deviceId,
    dataModelVersion: reported.dataModelVersion,
    version: reported.$version,
    applianceData: reported.applianceData
      ? {
          elc: reported.applianceData.elc,
          mac: reported.applianceData.mac,
          pnc: reported.applianceData.pnc,
          sn: reported.applianceData.sn,
        }
      : null,

    // Network - universal
    networkInterface: {
      linkQualityIndicator: toLowercase(reported.networkInterface?.linkQualityIndicator) as LinkQuality,
      rssi: reported.networkInterface?.rssi,
    },

    // Scheduler - common to many appliances
    schedulerMode: toLowercase(reported.schedulerMode) as OnOffNullableState,
    schedulerSession: toLowercase(reported.schedulerSession) as OnOffNullableState,
    startTime: reported.startTime,
    stopTime: reported.stopTime,

    // UI - universal
    uiLockMode: reported.uiLockMode,
    upgradeState: toLowercase(reported.upgradeState) as UpgradeState,

    // Capabilities and diagnostics - universal
    capabilities: reported.capabilities,
    tasks: reported.tasks,
    logE: reported.logE,
    logW: reported.logW,

    // Timezone - universal
    TimeZoneDaylightRule: reported.TimeZoneDaylightRule,
    TimeZoneStandardName: reported.TimeZoneStandardName,

    // Firmware versions - universal
    VmNo_MCU: reported.VmNo_MCU,
    VmNo_NIU: reported.VmNo_NIU,
  }
}

/**
 * Climate-specific normalization for portable air conditioners and similar devices
 * Extends base fields with climate control, temperature, fan, and compressor data
 */
export function normalizeClimateAppliance(rawState: Appliance): NormalizedState {
  const reported = extractReportedState(rawState)
  const baseFields = normalizeBaseFields(rawState)

  return {
    ...baseFields,

    // Climate control - specific to climate devices
    mode: normalizeClimateMode(reported.mode),
    targetTemperatureC: reported.targetTemperatureC,
    ambientTemperatureC: reported.ambientTemperatureC,
    ambientTemperatureF: reported.ambientTemperatureF,
    temperatureRepresentation: toLowercase(reported.temperatureRepresentation) as TemperatureUnit,

    // Fan control - climate devices
    fanSpeedSetting: normalizeFanSpeed(reported.fanSpeedSetting),
    verticalSwing: toLowercase(reported.verticalSwing) as OnOffState,
    sleepMode: toLowercase(reported.sleepMode) as OnOffState,

    // Compressor states - cooling/heating devices
    compressorState: toLowercase(reported.compressorState) as OnOffState,
    compressorCoolingRuntime: reported.compressorCoolingRuntime,
    compressorHeatingRuntime: reported.compressorHeatingRuntime,
    totalRuntime: reported.totalRuntime,

    // Filter states - climate devices
    filterState: toLowercase(reported.filterState) as FilterState,
    filterRuntime: reported.filterRuntime,
    hepaFilterLifeTime: reported.hepaFilterLifeTime,

    // Advanced states - climate devices
    fourWayValveState: toLowercase(reported.fourWayValveState) as OnOffNullableState,
    evapDefrostState: toLowercase(reported.evapDefrostState) as OnOffNullableState,
  } as NormalizedState
}

/**
 * @deprecated Use normalizeClimateAppliance instead
 * Kept for backward compatibility
 */
export function normalizeFromApiResponse(rawState: Appliance): NormalizedState {
  return normalizeClimateAppliance(rawState)
}

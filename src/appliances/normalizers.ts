import type {
  BaseNormalizedFields,
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

const VALID_ON_OFF: ReadonlySet<string> = new Set<OnOffState>(['on', 'off'])
const VALID_CONNECTION: ReadonlySet<string> = new Set<ConnectionState>(['connected', 'disconnected'])
const VALID_CLIMATE_MODES: ReadonlySet<string> = new Set<NormalizedClimateMode>([
  'cool',
  'heat',
  'fan_only',
  'dry',
  'auto',
  'off',
])
const VALID_FAN_MODES: ReadonlySet<string> = new Set<NormalizedFanMode>(['low', 'medium', 'high', 'auto'])

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
  const mapped = normalized === 'running' ? 'on' : normalized
  if (mapped !== undefined && VALID_ON_OFF.has(mapped)) {
    return mapped as OnOffState
  }
  return 'off'
}

/**
 * Normalize connection state from API format to standard format
 */
export function normalizeConnectionState(state: string | undefined): ConnectionState {
  const normalized = state?.toLowerCase()
  if (normalized !== undefined && VALID_CONNECTION.has(normalized)) {
    return normalized as ConnectionState
  }
  return 'disconnected'
}

/**
 * Normalize climate mode, handling the special "fanonly" case
 */
export function normalizeClimateMode(mode: string | undefined): NormalizedClimateMode {
  const normalized = mode?.toLowerCase()
  const mapped = normalized === 'fanonly' ? 'fan_only' : normalized
  if (mapped !== undefined && VALID_CLIMATE_MODES.has(mapped)) {
    return mapped as NormalizedClimateMode
  }
  return 'off'
}

/**
 * Normalize fan speed, handling the special "middle" to "medium" mapping
 */
export function normalizeFanSpeed(speed: string | undefined): NormalizedFanMode {
  const normalized = speed?.toLowerCase()
  const mapped = normalized === 'middle' ? 'medium' : normalized
  if (mapped !== undefined && VALID_FAN_MODES.has(mapped)) {
    return mapped as NormalizedFanMode
  }
  return 'auto'
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
  if (rawState?.properties?.reported) {
    return rawState.properties.reported
  }
  // Flat structure: the raw state IS the reported state (e.g., from cache after normalization)
  // Validate by checking for fields that exist on reported but not on the Appliance wrapper
  if (typeof rawState === 'object' && rawState !== null && 'applianceState' in rawState) {
    return rawState as unknown as Appliance['properties']['reported']
  }
  throw new Error('Invalid appliance state: missing properties.reported and not a flat reported structure')
}

/**
 * Base normalization for fields common to ALL Electrolux appliances
 * This handles universal fields like identity, network, device info, etc.
 */
export function normalizeBaseFields(rawState: Appliance): BaseNormalizedFields {
  const reported = extractReportedState(rawState)

  return {
    // Identity
    applianceId: rawState.applianceId,
    status: toLowercase(rawState.status) as EnabledState,
    connectionState: normalizeConnectionState(rawState.connectionState),
    applianceState: normalizeApplianceState(reported.applianceState),

    // Device information
    deviceId: reported.deviceId,
    dataModelVersion: reported.dataModelVersion,
    version: reported.$version ?? 0,
    applianceData: reported.applianceData
      ? {
          elc: reported.applianceData.elc,
          mac: reported.applianceData.mac,
          pnc: reported.applianceData.pnc,
          sn: reported.applianceData.sn,
        }
      : null,

    // Network
    networkInterface: {
      linkQualityIndicator: toLowercase(reported.networkInterface?.linkQualityIndicator) as LinkQuality,
      rssi: reported.networkInterface?.rssi ?? 0,
    },

    // Scheduler
    schedulerMode: toLowercase(reported.schedulerMode) as OnOffNullableState,
    schedulerSession: toLowercase(reported.schedulerSession) as OnOffNullableState,
    startTime: reported.startTime ?? 0,
    stopTime: reported.stopTime ?? 0,

    // UI
    uiLockMode: reported.uiLockMode ?? false,
    upgradeState: toLowercase(reported.upgradeState) as UpgradeState,

    // Capabilities and diagnostics
    capabilities: reported.capabilities ?? {},
    tasks: reported.tasks ?? {},
    logE: reported.logE ?? null,
    logW: reported.logW ?? null,

    // Timezone
    TimeZoneDaylightRule: reported.TimeZoneDaylightRule ?? null,
    TimeZoneStandardName: reported.TimeZoneStandardName ?? null,

    // Firmware versions
    VmNo_MCU: reported.VmNo_MCU ?? null,
    VmNo_NIU: reported.VmNo_NIU ?? null,
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

    // Climate control
    mode: normalizeClimateMode(reported.mode),
    targetTemperatureC: reported.targetTemperatureC ?? 0,
    ambientTemperatureC: reported.ambientTemperatureC ?? null,
    ambientTemperatureF: reported.ambientTemperatureF ?? null,
    temperatureRepresentation: toLowercase(reported.temperatureRepresentation) as TemperatureUnit,

    // Fan control
    fanSpeedSetting: normalizeFanSpeed(reported.fanSpeedSetting),
    verticalSwing: toLowercase(reported.verticalSwing) as OnOffState,
    sleepMode: toLowercase(reported.sleepMode) as OnOffState,

    // Compressor states
    compressorState: toLowercase(reported.compressorState) as OnOffState,
    compressorCoolingRuntime: reported.compressorCoolingRuntime ?? 0,
    compressorHeatingRuntime: reported.compressorHeatingRuntime ?? 0,
    totalRuntime: reported.totalRuntime ?? 0,

    // Filter states
    filterState: toLowercase(reported.filterState) as FilterState,
    filterRuntime: reported.filterRuntime ?? 0,
    hepaFilterLifeTime: reported.hepaFilterLifeTime ?? null,

    // Advanced states
    fourWayValveState: toLowercase(reported.fourWayValveState) as OnOffNullableState,
    evapDefrostState: toLowercase(reported.evapDefrostState) as OnOffNullableState,
  }
}

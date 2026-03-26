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
const VALID_ENABLED: ReadonlySet<string> = new Set<EnabledState>(['enabled', 'disabled'])
const VALID_LINK_QUALITY: ReadonlySet<string> = new Set<LinkQuality>([
  'excellent',
  'very_good',
  'good',
  'poor',
  'very_poor',
  'undefined',
])
const VALID_UPGRADE: ReadonlySet<string> = new Set<UpgradeState & string>(['idle', 'upgrading'])
const VALID_TEMPERATURE_UNIT: ReadonlySet<string> = new Set<TemperatureUnit>(['celsius', 'fahrenheit'])
const VALID_FILTER: ReadonlySet<string> = new Set<FilterState>(['clean', 'good', 'dirty'])

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
 * Normalize enabled/disabled state
 */
export function normalizeEnabledState(state: string | undefined): EnabledState {
  const normalized = state?.toLowerCase()
  if (normalized !== undefined && VALID_ENABLED.has(normalized)) {
    return normalized as EnabledState
  }
  return 'disabled'
}

/**
 * Normalize link quality indicator
 */
export function normalizeLinkQuality(quality: string | undefined | null): LinkQuality {
  const normalized = quality?.toLowerCase()
  if (normalized !== undefined && VALID_LINK_QUALITY.has(normalized)) {
    return normalized as LinkQuality
  }
  return 'undefined'
}

/**
 * Normalize on/off state with default fallback
 */
export function normalizeOnOffState(state: string | undefined | null): OnOffState {
  const normalized = state?.toLowerCase()
  if (normalized !== undefined && VALID_ON_OFF.has(normalized)) {
    return normalized as OnOffState
  }
  return 'off'
}

/**
 * Normalize nullable on/off state (returns null for unknown values)
 */
export function normalizeOnOffNullable(state: string | undefined | null): OnOffNullableState {
  const normalized = state?.toLowerCase()
  if (normalized !== undefined && VALID_ON_OFF.has(normalized)) {
    return normalized as OnOffState
  }
  return null
}

/**
 * Normalize upgrade state (returns null for unknown values)
 */
export function normalizeUpgradeState(state: string | undefined | null): UpgradeState {
  const normalized = state?.toLowerCase()
  if (normalized !== undefined && VALID_UPGRADE.has(normalized)) {
    return normalized as UpgradeState & string
  }
  return null
}

/**
 * Normalize temperature unit representation
 */
export function normalizeTemperatureUnit(unit: string | undefined | null): TemperatureUnit {
  const normalized = unit?.toLowerCase()
  if (normalized !== undefined && VALID_TEMPERATURE_UNIT.has(normalized)) {
    return normalized as TemperatureUnit
  }
  return 'celsius'
}

/**
 * Normalize filter state
 */
export function normalizeFilterState(state: string | undefined | null): FilterState {
  const normalized = state?.toLowerCase()
  if (normalized !== undefined && VALID_FILTER.has(normalized)) {
    return normalized as FilterState
  }
  return 'clean'
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
  // Validate by checking for required fields that exist on reported but not on the Appliance wrapper
  if (
    typeof rawState === 'object' &&
    rawState !== null &&
    'applianceState' in rawState &&
    'deviceId' in rawState &&
    'dataModelVersion' in rawState
  ) {
    // The three required reported fields are present, safe to treat as reported state
    const reported: Appliance['properties']['reported'] = rawState as unknown as Appliance['properties']['reported']
    return reported
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
    status: normalizeEnabledState(rawState.status),
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
      linkQualityIndicator: normalizeLinkQuality(reported.networkInterface?.linkQualityIndicator),
      rssi: reported.networkInterface?.rssi ?? 0,
    },

    // Scheduler
    schedulerMode: normalizeOnOffNullable(reported.schedulerMode),
    schedulerSession: normalizeOnOffNullable(reported.schedulerSession),
    startTime: reported.startTime ?? 0,
    stopTime: reported.stopTime ?? 0,

    // UI
    uiLockMode: reported.uiLockMode ?? false,
    upgradeState: normalizeUpgradeState(reported.upgradeState),

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
    temperatureRepresentation: normalizeTemperatureUnit(reported.temperatureRepresentation),

    // Fan control
    fanSpeedSetting: normalizeFanSpeed(reported.fanSpeedSetting),
    verticalSwing: normalizeOnOffState(reported.verticalSwing),
    sleepMode: normalizeOnOffState(reported.sleepMode),

    // Compressor states
    compressorState: normalizeOnOffState(reported.compressorState),
    compressorCoolingRuntime: reported.compressorCoolingRuntime ?? 0,
    compressorHeatingRuntime: reported.compressorHeatingRuntime ?? 0,
    totalRuntime: reported.totalRuntime ?? 0,

    // Filter states
    filterState: normalizeFilterState(reported.filterState),
    filterRuntime: reported.filterRuntime ?? 0,
    hepaFilterLifeTime: reported.hepaFilterLifeTime ?? null,

    // Advanced states
    fourWayValveState: normalizeOnOffNullable(reported.fourWayValveState),
    evapDefrostState: normalizeOnOffNullable(reported.evapDefrostState),
  }
}

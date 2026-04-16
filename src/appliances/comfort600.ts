import type { HAClimateDiscoveryConfig, HAClimateMode, HAFanMode, HASwingMode } from '@/types/homeassistant.js'
import type { NormalizedClimateMode, NormalizedState } from '@/types/normalized.js'
import type { Appliance } from '@/types.js'
import { BaseAppliance, type CommandValidationResult } from './base.js'
import {
  denormalizeClimateMode,
  denormalizeFanSpeed,
  normalizeClimateAppliance,
  normalizeFanSpeed,
} from './normalizers.js'

/**
 * Runtime type guard for the fanSpeedSetting action shape returned by
 * Electrolux API trigger actions. All fields are optional.
 */
export function isFanSpeedAction(value: unknown): value is { access?: string; values?: Record<string, unknown> } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if ('access' in v && typeof v.access !== 'string') return false
  if ('values' in v) {
    if (typeof v.values !== 'object' || v.values === null || Array.isArray(v.values)) return false
  }
  return true
}

/**
 * Runtime type guard for the targetTemperatureC action shape returned by
 * Electrolux API trigger actions. All fields are optional.
 */
export function isTempAction(value: unknown): value is { disabled?: boolean; min?: number; max?: number } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if ('disabled' in v && typeof v.disabled !== 'boolean') return false
  if ('min' in v && typeof v.min !== 'number') return false
  if ('max' in v && typeof v.max !== 'number') return false
  return true
}

/**
 * Runtime type guard for the sleepMode action shape returned by
 * Electrolux API trigger actions. The disabled field is optional.
 */
export function isSleepAction(value: unknown): value is { disabled?: boolean } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  if ('disabled' in v && typeof v.disabled !== 'boolean') return false
  return true
}

// Maps API mode values to HA climate modes (handles FANONLY → fan_only)
const API_MODE_TO_HA: Record<string, HAClimateMode> = {
  AUTO: 'auto',
  COOL: 'cool',
  DRY: 'dry',
  HEAT: 'heat',
  FANONLY: 'fan_only',
  OFF: 'off',
}

// Maps API fan speed values to HA fan modes (handles MIDDLE → medium)
const API_FAN_TO_HA: Record<string, HAFanMode> = {
  AUTO: 'auto',
  HIGH: 'high',
  MIDDLE: 'medium',
  LOW: 'low',
}

// Maps API swing values to HA swing modes
const API_SWING_TO_HA: Record<string, HASwingMode> = {
  ON: 'on',
  OFF: 'off',
}

/**
 * Electrolux COMFORT600 Portable Air Conditioner
 * Model: COMFORT600, Variant: AZULTM10
 * Device Type: PORTABLE_AIR_CONDITIONER
 *
 * Modes, fan speeds, and swing modes are derived from the API capabilities
 * at construction time — if the API adds or removes values, the HA discovery
 * config and validation adjust automatically.
 */
export class Comfort600Appliance extends BaseAppliance {
  public getModelName(): string {
    return 'COMFORT600'
  }

  public getSupportedModes(): HAClimateMode[] {
    const modeValues = this.applianceInfo.capabilities.mode?.values
    if (!modeValues) return ['off']
    const modes = Object.keys(modeValues)
      .map((v) => API_MODE_TO_HA[v])
      .filter((m): m is HAClimateMode => m !== undefined)
    // HA expects 'off' in the modes list even if the API marks it as disabled
    if (!modes.includes('off')) modes.push('off')
    return modes
  }

  public getSupportedFanModes(): HAFanMode[] {
    const fanValues = this.applianceInfo.capabilities.fanSpeedSetting?.values
    if (!fanValues) return ['auto']
    return Object.keys(fanValues)
      .map((v) => API_FAN_TO_HA[v])
      .filter((m): m is HAFanMode => m !== undefined)
  }

  public getSupportedSwingModes(): HASwingMode[] {
    const swingValues = this.applianceInfo.capabilities.verticalSwing?.values
    if (!swingValues) return ['off']
    return Object.keys(swingValues)
      .map((v) => API_SWING_TO_HA[v])
      .filter((m): m is HASwingMode => m !== undefined)
  }

  public getTemperatureRange(): { min: number; max: number; initial: number } {
    const capabilities = this.applianceInfo.capabilities.targetTemperatureC
    return {
      min: capabilities?.min ?? 16,
      max: capabilities?.max ?? 32,
      initial: capabilities?.default ?? 16,
    }
  }

  /**
   * Normalize the raw Electrolux API response to standardized format
   * Uses the climate appliance normalizer for COMFORT600
   */
  public normalizeState(rawState: Appliance): NormalizedState {
    return normalizeClimateAppliance(rawState)
  }

  /**
   * Transform MQTT command to Electrolux API format
   * Handles mode and fan speed denormalization
   */
  public transformMqttCommandToApi(rawCommand: Partial<NormalizedState>): Record<string, unknown> {
    const { mode, fanSpeedSetting, verticalSwing, sleepMode, ...otherCommands } = rawCommand

    // If mode is explicitly 'off', turn off the appliance
    // Otherwise, if any command is sent (including mode changes or other settings), turn on the appliance
    const executeCommand = mode?.toLowerCase() === 'off' ? 'OFF' : 'ON'

    const payload: Record<string, unknown> = {
      ...otherCommands,
      executeCommand,
    }

    // Add mode if not turning off
    if (executeCommand !== 'OFF' && mode) {
      payload.mode = denormalizeClimateMode(mode)
    }

    // Add fan speed if present
    if (fanSpeedSetting) {
      payload.fanSpeedSetting = denormalizeFanSpeed(fanSpeedSetting)
    }

    // Denormalize on/off fields to uppercase for the API
    if (verticalSwing) {
      payload.verticalSwing = verticalSwing.toUpperCase()
    }
    if (sleepMode) {
      payload.sleepMode = sleepMode.toUpperCase()
    }

    return payload
  }

  /**
   * For COMFORT600, executeCommand controls the applianceState
   * Update applianceState immediately when a command is sent
   */
  public deriveImmediateStateFromCommand(payload: Record<string, unknown>): Partial<NormalizedState> | null {
    if ('executeCommand' in payload) {
      return {
        applianceState: payload.executeCommand === 'OFF' ? 'off' : 'on',
      }
    }
    return null
  }

  /**
   * Find the mode trigger for the given mode. Returns null if no triggers
   * or no matching trigger exists (in which case all commands are allowed).
   */
  private findModeTrigger(mode: NormalizedClimateMode) {
    const triggers = this.applianceInfo.capabilities.mode?.triggers
    if (!triggers) return null
    const denormalized = denormalizeClimateMode(mode)
    return triggers.find((t) => t.condition.operand_2 === denormalized) ?? null
  }

  /**
   * Validate a command against mode-specific constraints from the capabilities triggers.
   * The Electrolux API returns triggers that define which fan speeds, temperature ranges,
   * and features are available per mode. This prevents sending commands the API will reject.
   */
  public override validateCommand(
    rawCommand: Partial<NormalizedState>,
    currentMode: NormalizedClimateMode,
  ): CommandValidationResult {
    // If the command includes a mode change, validate against the target mode
    const effectiveMode = rawCommand.mode ?? currentMode

    // Skip validation for off mode — no constraints apply
    if (effectiveMode === 'off') {
      return { valid: true }
    }

    const trigger = this.findModeTrigger(effectiveMode)
    if (!trigger) {
      return { valid: true }
    }

    // Validate fan speed
    if (rawCommand.fanSpeedSetting) {
      const result = this.validateFanSpeed(rawCommand.fanSpeedSetting, effectiveMode, trigger)
      if (!result.valid) return result
    }

    // Validate temperature
    if (rawCommand.targetTemperatureC !== undefined) {
      const result = this.validateTemperature(rawCommand.targetTemperatureC, effectiveMode, trigger)
      if (!result.valid) return result
    }

    // Validate sleep mode
    if (rawCommand.sleepMode) {
      const result = this.validateSleepMode(effectiveMode, trigger)
      if (!result.valid) return result
    }

    return { valid: true }
  }

  private validateFanSpeed(
    fanSpeed: string,
    mode: NormalizedClimateMode,
    trigger: { action: Record<string, unknown> },
  ): CommandValidationResult {
    const raw = trigger.action.fanSpeedSetting
    if (!isFanSpeedAction(raw)) {
      return { valid: true }
    }
    const fanAction = raw
    if (!fanAction.values) {
      return { valid: true }
    }

    if (fanAction.access === 'read') {
      return { valid: false, reason: `fan speed is read-only in '${mode}' mode` }
    }

    const allowedSpeeds = Object.keys(fanAction.values)
    const requestedSpeed = denormalizeFanSpeed(fanSpeed)

    if (!allowedSpeeds.includes(requestedSpeed)) {
      const normalizedAllowed = allowedSpeeds.map((s) => normalizeFanSpeed(s.toLowerCase())).join(', ')
      return {
        valid: false,
        reason: `fan speed '${fanSpeed}' is not allowed in '${mode}' mode (allowed: ${normalizedAllowed})`,
      }
    }

    return { valid: true }
  }

  private validateTemperature(
    temperature: number,
    mode: NormalizedClimateMode,
    trigger: { action: Record<string, unknown> },
  ): CommandValidationResult {
    const rawTemp = trigger.action.targetTemperatureC
    if (rawTemp === undefined || !isTempAction(rawTemp)) {
      return { valid: true }
    }
    const tempAction = rawTemp

    if (tempAction.disabled) {
      return { valid: false, reason: `temperature control is disabled in '${mode}' mode` }
    }

    if (tempAction.min !== undefined && temperature < tempAction.min) {
      return {
        valid: false,
        reason: `temperature ${temperature}°C is below minimum ${tempAction.min}°C in '${mode}' mode`,
      }
    }

    if (tempAction.max !== undefined && temperature > tempAction.max) {
      return {
        valid: false,
        reason: `temperature ${temperature}°C is above maximum ${tempAction.max}°C in '${mode}' mode`,
      }
    }

    return { valid: true }
  }

  private validateSleepMode(
    mode: NormalizedClimateMode,
    trigger: { action: Record<string, unknown> },
  ): CommandValidationResult {
    const rawSleep = trigger.action.sleepMode
    if (!isSleepAction(rawSleep)) {
      return { valid: true }
    }
    const sleepAction = rawSleep
    if (sleepAction.disabled) {
      return { valid: false, reason: `sleep mode is disabled in '${mode}' mode` }
    }
    return { valid: true }
  }

  public generateAutoDiscoveryConfig(topicPrefix: string): HAClimateDiscoveryConfig {
    const info = this.applianceInfo.applianceInfo
    const tempRange = this.getTemperatureRange()
    // Ensure topicPrefix ends with /
    const prefix = topicPrefix.endsWith('/') ? topicPrefix : `${topicPrefix}/`
    const stateTopic = `${prefix}${this.applianceId}/state`
    const commandTopic = `${prefix}${this.applianceId}/command`

    return {
      name: '',
      object_id: `${info.brand}_${info.model}_${info.serialNumber}`,
      uniq_id: `${info.brand}_${info.model}_${this.applianceId}`,
      device: {
        identifiers: [this.applianceId],
        manufacturer: info.brand,
        model: info.model,
        name: this.applianceName,
      },
      availability_topic: stateTopic,
      availability_template: '{{ value_json.connectionState }}',
      payload_available: 'connected',
      payload_not_available: 'disconnected',
      json_attributes_topic: stateTopic,
      modes: this.getSupportedModes(),
      mode_state_topic: stateTopic,
      mode_state_template:
        "{{ 'off' if value_json.applianceState == 'off' else ('fan_only' if value_json.mode == 'fan_only' else value_json.mode | lower) }}",
      mode_command_topic: commandTopic,
      mode_command_template: '{ "mode": "{{ value }}" }',
      precision: 1,
      temperature_unit: 'C',
      initial: tempRange.initial,
      min_temp: tempRange.min,
      max_temp: tempRange.max,
      current_temperature_topic: stateTopic,
      current_temperature_template: '{{ value_json.ambientTemperatureC }}',
      temperature_command_topic: commandTopic,
      temperature_command_template: '{ "targetTemperatureC": {{ value }} }',
      temperature_state_topic: stateTopic,
      temperature_state_template: '{{ value_json.targetTemperatureC }}',
      fan_modes: this.getSupportedFanModes(),
      fan_mode_state_topic: stateTopic,
      fan_mode_state_template:
        '{{ value_json.fanSpeedSetting if value_json.fanSpeedSetting != "middle" else "medium" }}',
      fan_mode_command_topic: commandTopic,
      fan_mode_command_template: '{ "fanSpeedSetting": "{{ value }}" }',
      swing_modes: this.getSupportedSwingModes(),
      swing_mode_state_topic: stateTopic,
      swing_mode_state_template: '{{ value_json.verticalSwing }}',
      swing_mode_command_topic: commandTopic,
      swing_mode_command_template: '{ "verticalSwing": "{{ value }}" }',
    }
  }
}

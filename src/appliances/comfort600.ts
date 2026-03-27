import type { HAClimateDiscoveryConfig, HAClimateMode, HAFanMode, HASwingMode } from '../types/homeassistant.js'
import type { NormalizedClimateMode, NormalizedState } from '../types/normalized.js'
import type { Appliance } from '../types.js'
import { BaseAppliance, type CommandValidationResult } from './base.js'
import {
  denormalizeClimateMode,
  denormalizeFanSpeed,
  normalizeClimateAppliance,
  normalizeFanSpeed,
} from './normalizers.js'

/**
 * Electrolux COMFORT600 Portable Air Conditioner
 * Model: COMFORT600, Variant: AZULTM10
 * Device Type: PORTABLE_AIR_CONDITIONER
 */
export class Comfort600Appliance extends BaseAppliance {
  public getModelName(): string {
    return 'COMFORT600'
  }

  public getSupportedModes(): HAClimateMode[] {
    return ['auto', 'cool', 'dry', 'fan_only', 'heat', 'off']
  }

  public getSupportedFanModes(): HAFanMode[] {
    return ['auto', 'high', 'medium', 'low']
  }

  public getSupportedSwingModes(): HASwingMode[] {
    return ['on', 'off']
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
   * Validate a command against mode-specific constraints from the capabilities triggers.
   * The Electrolux API returns triggers that define which fan speeds, temperature ranges,
   * and features are available per mode. This prevents sending commands the API will reject.
   */
  public override validateCommand(
    rawCommand: Partial<NormalizedState>,
    currentMode: NormalizedClimateMode,
  ): CommandValidationResult {
    if (!rawCommand.fanSpeedSetting) {
      return { valid: true }
    }

    // If the command includes a mode change, validate against the target mode
    const effectiveMode = rawCommand.mode ?? currentMode

    // Skip validation for off mode — no constraints apply
    if (effectiveMode === 'off') {
      return { valid: true }
    }

    const triggers = this.applianceInfo.capabilities.mode?.triggers
    if (!triggers) {
      return { valid: true }
    }

    // Find the trigger for the effective mode
    const denormalizedMode = denormalizeClimateMode(effectiveMode)
    const trigger = triggers.find((t) => t.condition.operand_2 === denormalizedMode)
    if (!trigger) {
      return { valid: true }
    }

    const fanAction = trigger.action.fanSpeedSetting as
      | { access?: string; values?: Record<string, unknown> }
      | undefined
    if (!fanAction?.values) {
      return { valid: true }
    }

    // Check if the requested fan speed is in the allowed values for this mode
    const allowedSpeeds = Object.keys(fanAction.values)
    const requestedSpeed = denormalizeFanSpeed(rawCommand.fanSpeedSetting)

    if (!allowedSpeeds.includes(requestedSpeed)) {
      const normalizedAllowed = allowedSpeeds.map((s) => normalizeFanSpeed(s.toLowerCase())).join(', ')
      return {
        valid: false,
        reason: `fan speed '${rawCommand.fanSpeedSetting}' is not allowed in '${effectiveMode}' mode (allowed: ${normalizedAllowed})`,
      }
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

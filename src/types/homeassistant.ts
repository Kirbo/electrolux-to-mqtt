/**
 * Home Assistant MQTT Climate Device Types
 * Based on: https://www.home-assistant.io/integrations/climate.mqtt/
 */

export type HAClimateMode = 'auto' | 'cool' | 'dry' | 'fan_only' | 'heat' | 'off'
export type HAFanMode = 'auto' | 'high' | 'medium' | 'low'
export type HASwingMode = 'on' | 'off'

export interface HAClimateState {
  applianceState: 'on' | 'off'
  mode: HAClimateMode
  targetTemperatureC: number
  ambientTemperatureC: number | null
  fanSpeedSetting: HAFanMode
  verticalSwing: HASwingMode
  connectionState: 'connected' | 'disconnected'
}

export interface HAClimateDiscoveryConfig {
  name: string
  object_id: string
  uniq_id: string
  device: {
    identifiers: string[]
    manufacturer: string
    model: string
    name: string
  }
  availability_topic: string
  availability_template: string
  payload_available: string
  payload_not_available: string
  json_attributes_topic: string
  modes: HAClimateMode[]
  mode_state_topic: string
  mode_state_template: string
  mode_command_topic: string
  mode_command_template: string
  precision: number
  temperature_unit: 'C' | 'F'
  initial: number
  min_temp: number
  max_temp: number
  current_temperature_topic: string
  current_temperature_template: string
  temperature_state_topic: string
  temperature_state_template: string
  temperature_command_topic: string
  temperature_command_template: string
  fan_modes: HAFanMode[]
  fan_mode_state_topic: string
  fan_mode_state_template: string
  fan_mode_command_topic: string
  fan_mode_command_template: string
  swing_modes: HASwingMode[]
  swing_mode_state_topic: string
  swing_mode_state_template: string
  swing_mode_command_topic: string
  swing_mode_command_template: string
}

import type { HAClimateDiscoveryConfig, HAClimateMode, HAFanMode, HASwingMode } from '../types/homeassistant.js'
import type { NormalizedState } from '../types/normalized.js'
import type { Appliance, ApplianceInfo, ApplianceStub } from '../types.js'

/**
 * Base class for all Electrolux appliances
 * Specific appliance models should extend this class and implement the abstract methods
 */
export abstract class BaseAppliance {
  protected readonly applianceId: string
  protected readonly applianceName: string
  protected readonly applianceType: string
  protected readonly applianceInfo: ApplianceInfo

  constructor(stub: ApplianceStub, info: ApplianceInfo) {
    this.applianceId = stub.applianceId
    this.applianceName = stub.applianceName
    this.applianceType = stub.applianceType
    this.applianceInfo = info
  }

  /**
   * Get the appliance ID
   */
  public getApplianceId(): string {
    return this.applianceId
  }

  /**
   * Get the appliance name
   */
  public getApplianceName(): string {
    return this.applianceName
  }

  /**
   * Get the appliance type
   */
  public getApplianceType(): string {
    return this.applianceType
  }

  /**
   * Get the appliance info
   */
  public getApplianceInfo(): ApplianceInfo {
    return this.applianceInfo
  }

  /**
   * Normalize the raw Electrolux API state to a standardized format
   * This method transforms the Electrolux-specific state format (from API response) to a normalized format
   */
  abstract normalizeState(rawState: Appliance): NormalizedState

  /**
   * Transform an MQTT command into an Electrolux API command payload
   * This method handles the conversion from Home Assistant MQTT format to Electrolux API format
   */
  abstract transformMqttCommandToApi(rawCommand: Partial<NormalizedState>): Record<string, unknown>

  /**
   * Derive immediate state updates from the API command payload
   * This allows appliances to update their state immediately after a command is sent,
   * without waiting for the API to reflect the change
   * @param payload - The API command payload that was sent
   * @returns Partial state updates to apply immediately, or null if no immediate updates needed
   */
  public deriveImmediateStateFromCommand(_payload: Record<string, unknown>): Partial<NormalizedState> | null {
    return null // Default: no immediate state updates
  }

  /**
   * Generate Home Assistant MQTT auto-discovery configuration
   * This creates the configuration message that Home Assistant uses to auto-discover the device
   */
  abstract generateAutoDiscoveryConfig(topicPrefix: string): HAClimateDiscoveryConfig

  /**
   * Get supported climate modes for this appliance
   */
  abstract getSupportedModes(): HAClimateMode[]

  /**
   * Get supported fan modes for this appliance
   */
  abstract getSupportedFanModes(): HAFanMode[]

  /**
   * Get supported swing modes for this appliance
   */
  abstract getSupportedSwingModes(): HASwingMode[]

  /**
   * Get temperature range (min, max) for this appliance
   */
  abstract getTemperatureRange(): { min: number; max: number; initial: number }

  /**
   * Get the model name/identifier for this appliance
   * Used for factory pattern matching
   */
  abstract getModelName(): string
}

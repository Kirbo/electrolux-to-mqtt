import createLogger from '../logger.js'
import type { ApplianceInfo, ApplianceStub } from '../types.js'
import { BaseAppliance } from './base.js'
import { Comfort600Appliance } from './comfort600.js'

const logger = createLogger('factory')

/**
 * Factory for creating appliance instances based on model information
 * This allows the application to automatically select the appropriate appliance class
 * based on the appliance's model, device type, or variant
 */
export class ApplianceFactory {
  /**
   * Create an appliance instance based on the appliance information
   * @param stub - Basic appliance information from the Electrolux API
   * @param info - Detailed appliance information including capabilities
   * @returns An instance of the appropriate appliance class
   */
  public static create(stub: ApplianceStub, info: ApplianceInfo): BaseAppliance {
    const { model, deviceType, variant } = info.applianceInfo

    logger.debug(`Creating appliance instance for model: ${model}, deviceType: ${deviceType}, variant: ${variant}`)

    // Match by model name
    if (model === 'COMFORT600') {
      logger.info(`Matched appliance ${stub.applianceId} to COMFORT600 model`)
      return new Comfort600Appliance(stub, info)
    }

    // Match by device type and variant
    if (deviceType === 'PORTABLE_AIR_CONDITIONER' && variant?.includes('AZUL')) {
      logger.info(`Matched appliance ${stub.applianceId} to COMFORT600 model via device type and variant`)
      return new Comfort600Appliance(stub, info)
    }

    // Default fallback - use COMFORT600 as the generic climate appliance
    logger.warn(
      `No specific model match found for ${model}/${deviceType}/${variant}, falling back to COMFORT600 implementation`,
    )
    return new Comfort600Appliance(stub, info)
  }

  /**
   * Get a list of all supported models
   * Useful for documentation or UI purposes
   */
  public static getSupportedModels(): string[] {
    return ['COMFORT600']
  }
}

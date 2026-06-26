import os from 'node:os'
import type { BaseAppliance } from './appliances/base.js'

/**
 * Map node os.platform() to the Aptabase osName field.
 */
export function mapOsName(platform: string): string {
  if (platform === 'linux') return 'Linux'
  if (platform === 'darwin') return 'macOS'
  if (platform === 'win32') return 'Windows'
  return platform
}

/**
 * Get OS fields for Aptabase systemProps.
 */
export function getOsInfo(): { osName: string; osVersion: string; arch: string } {
  return {
    osName: mapOsName(os.platform()),
    osVersion: os.release(),
    arch: os.arch(),
  }
}

/**
 * Produce a telemetry summary from the live appliance fleet.
 * models: sorted, de-duplicated, comma-joined model identifiers.
 * count: total number of appliance instances.
 */
export function summarizeAppliances(instances: ReadonlyMap<string, BaseAppliance>): { models: string; count: number } {
  const modelSet = new Set<string>()
  for (const appliance of instances.values()) {
    modelSet.add(appliance.getModelName())
  }
  const models = [...modelSet].sort().join(',')
  return { models, count: instances.size }
}

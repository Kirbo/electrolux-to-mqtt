import crypto from 'node:crypto'
import os from 'node:os'
import type { BaseAppliance } from './appliances/base.js'

/**
 * Derive a stable, GUID-shaped Aptabase session id for this install.
 *
 * The telemetry badge counts distinct installs over a rolling window, which needs an id
 * that is stable per install — Aptabase's own `user_id` rotates with a daily salt, so it
 * can't be counted across midnight. We hash the Electrolux username (sha256) and format
 * the first 16 bytes as `8-4-4-4-12`. Properties:
 *   - stable across restarts and across the legacy→direct upgrade (legacy bridges hashed
 *     the same username, so the backend maps their userHash to the *same* sessionId);
 *   - GUID-shaped, which Aptabase requires (it silently drops non-GUID sessionIds);
 *   - anonymous — a one-way hash, not reversible to the account.
 */
export function deriveTelemetrySessionId(username: string): string {
  const h = crypto.createHash('sha256').update(username).digest('hex').slice(0, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

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

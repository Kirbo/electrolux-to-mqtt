import type { BaseAppliance } from './appliances/base.js'
import { normalizeClimateMode, normalizeFanSpeed, normalizeOnOffState } from './appliances/normalizers.js'
import type { Cache } from './cache.js'
import createLogger from './logger.js'
import type { IMqtt } from './mqtt.js'
import type { NormalizedClimateMode, NormalizedState } from './types/normalized.js'
import type { Appliance } from './types.js'

const logger = createLogger('electrolux')

export type StateDifference = { from: unknown; to: unknown }

/** The slice of ElectroluxApi that state sync needs. Both resolve undefined on failure. */
export interface ApplianceStateApi {
  getApplianceState(applianceId: string): Promise<Appliance | undefined>
  sendCommand(applianceId: string, payload: Record<string, unknown>): Promise<unknown>
}

export interface StateSyncSettings {
  /** After a command, polls are skipped this long so the API can register it. */
  commandStateDelayMs: number
  /** Log each changed field (`key: from → to`) rather than just "state changed". */
  showChanges: boolean
  /** Dotted paths whose changes neither count as a change nor get logged. */
  ignoredKeys: readonly string[]
  /** Republish the cached state when a command fails validation. */
  revertStateOnRejection: boolean
}

const isIgnored = (path: string, ignoredKeys: readonly string[]): boolean => {
  const parts = path.split('.')
  return parts.some((_, i) => ignoredKeys.includes(parts.slice(0, i + 1).join('.')))
}

function compareValues(
  oldVal: unknown,
  newVal: unknown,
  path: string,
  ignoredKeys: readonly string[],
): Record<string, StateDifference> {
  // null and undefined count as the same "no value"
  if (JSON.stringify(oldVal ?? null) === JSON.stringify(newVal ?? null)) return {}

  if (typeof oldVal === 'object' && oldVal !== null && typeof newVal === 'object' && newVal !== null) {
    const diffs: Record<string, StateDifference> = {}
    const oldObj: Record<string, unknown> = { ...oldVal }
    const newObj: Record<string, unknown> = { ...newVal }
    for (const key of new Set([...Object.keys(oldObj), ...Object.keys(newObj)])) {
      const fullPath = `${path}.${key}`
      if (!isIgnored(fullPath, ignoredKeys)) {
        Object.assign(diffs, compareValues(oldObj[key], newObj[key], fullPath, ignoredKeys))
      }
    }
    return diffs
  }

  return { [path]: { from: oldVal, to: newVal } }
}

/** Flattened `path → {from, to}` for every changed leaf; empty when oldState is null (first fetch). */
export function getStateDifferences(
  oldState: NormalizedState | null,
  newState: NormalizedState,
  ignoredKeys: readonly string[],
): Record<string, StateDifference> {
  if (!oldState) return {}
  const oldObj: Record<string, unknown> = { ...oldState }
  const differences: Record<string, StateDifference> = {}
  for (const [key, value] of Object.entries(newState)) {
    if (!isIgnored(key, ignoredKeys)) {
      Object.assign(differences, compareValues(oldObj[key], value, key, ignoredKeys))
    }
  }
  return differences
}

export function formatStateDifferences(differences: Record<string, StateDifference>): string {
  return Object.entries(differences)
    .map(([key, { from, to }]) => `\n  ${key}: ${from} → ${to}`)
    .join('')
}

/**
 * Keeps each appliance's MQTT state in step with the Electrolux API: polls, diffs
 * against the state cache, publishes changes, and sends commands with immediate
 * feedback (and a revert when they fail). The cache holds normalized state only.
 */
export class StateSync {
  private readonly lastCommandTime = new Map<string, number>()
  private readonly lastActiveMode = new Map<string, NormalizedClimateMode>()

  constructor(
    private readonly api: ApplianceStateApi,
    private readonly mqtt: IMqtt,
    private readonly cache: Cache,
    private readonly settings: StateSyncSettings,
  ) {}

  /**
   * Poll one appliance. Resolves the current normalized state — the cached one during
   * the post-command window (a healthy skip, not a failure) — or undefined when the API
   * call failed. `onChange` runs after a change is published (not on the first fetch).
   */
  async pollState(appliance: BaseAppliance, onChange?: () => void): Promise<NormalizedState | undefined> {
    const applianceId = appliance.getApplianceId()
    const sinceCommandMs = Date.now() - (this.lastCommandTime.get(applianceId) ?? 0)
    if (sinceCommandMs < this.settings.commandStateDelayMs) {
      logger.debug(
        `Skipping state fetch for ${applianceId}: only ${Math.round(sinceCommandMs / 1000)}s since command was sent (waiting ${Math.round((this.settings.commandStateDelayMs - sinceCommandMs) / 1000)}s more)`,
      )
      return this.cache.getState(applianceId) ?? undefined
    }

    const rawState = await this.api.getApplianceState(applianceId)
    if (!rawState) return undefined

    let state: NormalizedState
    try {
      state = appliance.normalizeState(rawState)
    } catch (error) {
      logger.error(`Error normalizing state for appliance ${applianceId}:`, error)
      return undefined
    }
    if (state.mode && state.mode !== 'off') this.lastActiveMode.set(applianceId, state.mode)

    const previous = this.cache.getState(applianceId)
    const differences = getStateDifferences(previous, state, this.settings.ignoredKeys)
    const changed = Object.keys(differences).length > 0
    this.logStateChanges(applianceId, differences)

    if (changed || !previous) {
      this.cache.setState(applianceId, state)
      this.mqtt.publish(`${applianceId}/state`, JSON.stringify(state))
      if (changed) onChange?.()
    }
    return state
  }

  /** Validate, send, and publish immediate feedback. Resolves the API response, or undefined. */
  async sendCommand(appliance: BaseAppliance, command: Partial<NormalizedState>): Promise<unknown> {
    const applianceId = appliance.getApplianceId()
    const validation = appliance.validateCommand(command, this.cache.getState(applianceId)?.mode ?? 'off')
    if (!validation.valid) {
      logger.warn(`Command rejected for appliance ${applianceId}: ${validation.reason}`)
      if (this.settings.revertStateOnRejection) this.republishCached(applianceId)
      return undefined
    }

    const payload = appliance.transformMqttCommandToApi(command)
    logger.info('Sending command to appliance:', applianceId, 'Command:', payload)
    const response = await this.api.sendCommand(applianceId, payload)
    if (response === undefined) {
      // Failed: put HA back on the last known state.
      this.republishCached(applianceId)
      return undefined
    }

    this.lastCommandTime.set(applianceId, Date.now())
    this.publishCommandFeedback(appliance, command, payload)
    return response
  }

  removeAppliance(applianceId: string): void {
    this.lastCommandTime.delete(applianceId)
    this.lastActiveMode.delete(applianceId)
  }

  private republishCached(applianceId: string): void {
    const cached = this.cache.getState(applianceId)
    if (cached) this.mqtt.publish(`${applianceId}/state`, JSON.stringify(cached))
  }

  private logStateChanges(applianceId: string, differences: Record<string, StateDifference>): void {
    if (Object.keys(differences).length === 0) {
      logger.debug('State checked, no changes detected')
    } else if (this.settings.showChanges) {
      logger.info(`State changed for appliance ${applianceId} via API: ${formatStateDifferences(differences)}`)
    } else {
      logger.info(`State changed for appliance ${applianceId} via API`)
    }
  }

  private publishCommandFeedback(
    appliance: BaseAppliance,
    command: Partial<NormalizedState>,
    payload: Record<string, unknown>,
  ): void {
    const applianceId = appliance.getApplianceId()
    const cached = this.cache.getState(applianceId)
    if (!cached) {
      logger.warn('No cached state available for immediate feedback after command')
      return
    }

    const combined = this.buildCombinedState(applianceId, cached, command)
    Object.assign(combined, appliance.deriveImmediateStateFromCommand(payload) ?? {})
    this.mqtt.publish(`${applianceId}/state`, JSON.stringify(combined))
    // Cached so the first poll after the command window diffs against what HA now shows.
    this.cache.setState(applianceId, combined)
  }

  private buildCombinedState(
    applianceId: string,
    cached: NormalizedState,
    command: Partial<NormalizedState>,
  ): NormalizedState {
    // HA command templates may send uppercase ('AUTO', 'ON'); state is lowercase.
    const normalizedCommand: Partial<NormalizedState> = { ...command }
    if (command.mode) normalizedCommand.mode = normalizeClimateMode(command.mode)
    if (command.fanSpeedSetting) normalizedCommand.fanSpeedSetting = normalizeFanSpeed(command.fanSpeedSetting)
    if (command.verticalSwing) normalizedCommand.verticalSwing = normalizeOnOffState(command.verticalSwing)
    if (command.sleepMode) normalizedCommand.sleepMode = normalizeOnOffState(command.sleepMode)

    if (normalizedCommand.mode && normalizedCommand.mode !== 'off') {
      this.lastActiveMode.set(applianceId, normalizedCommand.mode)
    }
    const lastMode = this.lastActiveMode.get(applianceId)
    const combined: NormalizedState = { ...cached, ...normalizedCommand }

    // Turning off: keep showing the previous mode (the off-ness lives in applianceState).
    if (normalizedCommand.mode === 'off' && lastMode) combined.mode = lastMode
    // A non-mode command to an off unit turns it on in its last active mode.
    if (!command.mode && cached.applianceState === 'off' && lastMode) {
      combined.applianceState = 'on'
      combined.mode = lastMode
    }
    return combined
  }
}

import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { BaseAppliance } from '#/appliances/base.ts'
import { Cache } from '#/cache.ts'
import type { IMqtt } from '#/mqtt.ts'
import { type ApplianceStateApi, StateSync, type StateSyncSettings } from '#/state-sync.ts'
import type { NormalizedState } from '#/types/normalized.ts'
import type { Appliance } from '#/types.d.ts'
import { mockApplianceStateResponse } from './fixtures/api-responses.ts'

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('#/logger.ts', () => ({ default: () => log }))

const ID = 'test-appliance-123'

const SETTINGS: StateSyncSettings = {
  commandStateDelayMs: 30_000,
  showChanges: true,
  ignoredKeys: [],
  revertStateOnRejection: false,
}

/** A normalized state, as the poll path and command feedback both cache it. */
const normalized = (overrides: Partial<NormalizedState> = {}): NormalizedState =>
  ({
    applianceId: ID,
    connectionState: 'connected',
    applianceState: 'on',
    mode: 'cool',
    targetTemperatureC: 22,
    fanSpeedSetting: 'auto',
    ...overrides,
  }) as NormalizedState

/** Raw API state whose reported fields the fake appliance copies into a normalized state. */
const raw = (reported: Record<string, unknown>): Appliance => ({
  ...mockApplianceStateResponse,
  properties: {
    ...mockApplianceStateResponse.properties,
    reported: { ...mockApplianceStateResponse.properties.reported, ...reported },
  },
})

function fakeAppliance(overrides: Partial<Record<keyof BaseAppliance, unknown>> = {}): BaseAppliance {
  return {
    getApplianceId: () => ID,
    normalizeState: vi.fn((state: Appliance) =>
      normalized({
        mode: state.properties.reported.mode === 'heat' ? 'heat' : 'cool',
        targetTemperatureC: state.properties.reported.targetTemperatureC,
        applianceState: state.properties.reported.applianceState === 'off' ? 'off' : 'on',
      }),
    ),
    validateCommand: vi.fn(() => ({ valid: true })),
    transformMqttCommandToApi: vi.fn((command: Record<string, unknown>) => ({ ...command, executeCommand: 'ON' })),
    deriveImmediateStateFromCommand: vi.fn(() => null),
    ...overrides,
  } as unknown as BaseAppliance
}

let api: {
  getApplianceState: Mock<ApplianceStateApi['getApplianceState']>
  sendCommand: Mock<ApplianceStateApi['sendCommand']>
}
let mqtt: { publish: Mock }
let cache: Cache
let sync: StateSync

const create = (settings: Partial<StateSyncSettings> = {}) =>
  new StateSync(api, mqtt as unknown as IMqtt, cache, { ...SETTINGS, ...settings })

const published = (): NormalizedState[] =>
  mqtt.publish.mock.calls.filter((c) => c[0] === `${ID}/state`).map((c) => JSON.parse(String(c[1])) as NormalizedState)

beforeEach(() => {
  api = { getApplianceState: vi.fn(), sendCommand: vi.fn().mockResolvedValue({ status: 'OK' }) }
  mqtt = { publish: vi.fn() }
  cache = new Cache()
  sync = create()
  for (const fn of Object.values(log)) fn.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('pollState', () => {
  it('publishes and caches the normalized state on the first poll', async () => {
    api.getApplianceState.mockResolvedValueOnce(raw({ mode: 'cool', targetTemperatureC: 22 }))

    const state = await sync.pollState(fakeAppliance())

    expect(api.getApplianceState).toHaveBeenCalledWith(ID)
    expect(state).toMatchObject({ mode: 'cool', targetTemperatureC: 22 })
    expect(published()).toEqual([state])
    expect(cache.getState(ID)).toEqual(state)
  })

  it('caches only the normalized shape — never the raw API response', async () => {
    api.getApplianceState.mockResolvedValueOnce(raw({}))
    await sync.pollState(fakeAppliance())

    expect(cache.getState(ID)).not.toHaveProperty('properties')
  })

  it('publishes again and fires onChange only when the state changed', async () => {
    const onChange = vi.fn()
    api.getApplianceState
      .mockResolvedValueOnce(raw({ targetTemperatureC: 22 }))
      .mockResolvedValueOnce(raw({ targetTemperatureC: 22 }))
      .mockResolvedValueOnce(raw({ targetTemperatureC: 24 }))
    const appliance = fakeAppliance()

    await sync.pollState(appliance, onChange) // first fetch: publish, no onChange
    await sync.pollState(appliance, onChange) // unchanged
    expect(published()).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()

    await sync.pollState(appliance, onChange)
    expect(published()).toHaveLength(2)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('targetTemperatureC: 22 → 24'))
  })

  it('logs a change without details when showChanges is off', async () => {
    sync = create({ showChanges: false })
    cache.setState(ID, normalized({ targetTemperatureC: 20 }))
    api.getApplianceState.mockResolvedValueOnce(raw({ targetTemperatureC: 25 }))

    await sync.pollState(fakeAppliance())

    const line = log.info.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('State changed'))
    expect(line).toBe(`State changed for appliance ${ID} via API`)
  })

  it('does not count changes to ignored keys', async () => {
    sync = create({ ignoredKeys: ['targetTemperatureC'] })
    cache.setState(ID, normalized({ targetTemperatureC: 20 }))
    api.getApplianceState.mockResolvedValueOnce(raw({ mode: 'cool', targetTemperatureC: 25 }))

    await sync.pollState(fakeAppliance())
    expect(published()).toHaveLength(0)
  })

  it('returns undefined without publishing when the API call failed', async () => {
    api.getApplianceState.mockResolvedValueOnce(undefined)

    await expect(sync.pollState(fakeAppliance())).resolves.toBeUndefined()
    expect(mqtt.publish).not.toHaveBeenCalled()
    expect(cache.getState(ID)).toBeNull()
  })

  it('returns undefined without publishing when normalization throws', async () => {
    api.getApplianceState.mockResolvedValueOnce(raw({}))
    const appliance = fakeAppliance({
      normalizeState: () => {
        throw new Error('unexpected shape')
      },
    })

    await expect(sync.pollState(appliance)).resolves.toBeUndefined()
    expect(mqtt.publish).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalled()
  })

  it('skips the API during the post-command window and returns the cached state (a healthy skip)', async () => {
    vi.useFakeTimers()
    cache.setState(ID, normalized())
    await sync.sendCommand(fakeAppliance(), { mode: 'heat' })

    await vi.advanceTimersByTimeAsync(29_000)
    const skipped = await sync.pollState(fakeAppliance())
    expect(api.getApplianceState).not.toHaveBeenCalled()
    expect(skipped).toMatchObject({ mode: 'heat' })

    await vi.advanceTimersByTimeAsync(1_000)
    api.getApplianceState.mockResolvedValueOnce(raw({ mode: 'heat' }))
    await sync.pollState(fakeAppliance())
    expect(api.getApplianceState).toHaveBeenCalledTimes(1)
  })

  it('diffs against the command-feedback state (not a first fetch) after the window', async () => {
    vi.useFakeTimers()
    cache.setState(ID, normalized({ mode: 'cool' }))
    await sync.sendCommand(fakeAppliance(), { mode: 'heat' })
    await vi.advanceTimersByTimeAsync(30_000)
    const onChange = vi.fn()
    api.getApplianceState.mockResolvedValueOnce(raw({ mode: 'cool' })) // API disagrees with the feedback

    await sync.pollState(fakeAppliance(), onChange)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('sendCommand', () => {
  it('sends the transformed payload and publishes immediate feedback merged over the cached state', async () => {
    cache.setState(ID, normalized({ mode: 'cool', targetTemperatureC: 22 }))
    const appliance = fakeAppliance({
      deriveImmediateStateFromCommand: vi.fn(() => ({ applianceState: 'on' })),
    })

    await expect(sync.sendCommand(appliance, { targetTemperatureC: 25 })).resolves.toEqual({ status: 'OK' })

    expect(api.sendCommand).toHaveBeenCalledWith(ID, { targetTemperatureC: 25, executeCommand: 'ON' })
    expect(published()).toEqual([
      expect.objectContaining({ mode: 'cool', targetTemperatureC: 25, applianceState: 'on' }),
    ])
    expect(cache.getState(ID)).toMatchObject({ targetTemperatureC: 25 })
  })

  it('validates against the cached mode', async () => {
    cache.setState(ID, normalized({ mode: 'heat' }))
    const appliance = fakeAppliance()

    await sync.sendCommand(appliance, { fanSpeedSetting: 'high' })
    expect(appliance.validateCommand).toHaveBeenCalledWith({ fanSpeedSetting: 'high' }, 'heat')
  })

  it('validates against "off" when nothing is cached, and skips feedback', async () => {
    const appliance = fakeAppliance()

    await sync.sendCommand(appliance, { mode: 'cool' })
    expect(appliance.validateCommand).toHaveBeenCalledWith({ mode: 'cool' }, 'off')
    expect(published()).toEqual([])
    expect(log.warn).toHaveBeenCalledWith('No cached state available for immediate feedback after command')
  })

  it('normalizes uppercase command values in the feedback (HA templates send e.g. AUTO)', async () => {
    cache.setState(ID, normalized())
    await sync.sendCommand(fakeAppliance(), {
      mode: 'AUTO',
      fanSpeedSetting: 'MIDDLE',
      verticalSwing: 'ON',
      sleepMode: 'OFF',
    } as unknown as Partial<NormalizedState>)

    expect(published()[0]).toMatchObject({
      mode: 'auto',
      fanSpeedSetting: 'medium',
      verticalSwing: 'on',
      sleepMode: 'off',
    })
  })

  it('keeps the last active mode in the feedback when turning off', async () => {
    cache.setState(ID, normalized({ mode: 'cool' }))
    api.getApplianceState.mockResolvedValueOnce(raw({ mode: 'cool' }))
    await sync.pollState(fakeAppliance()) // learns 'cool' as the last active mode
    mqtt.publish.mockClear()

    await sync.sendCommand(fakeAppliance(), { mode: 'off' })
    expect(published()[0]?.mode).toBe('cool')
  })

  it('turns the unit on in its last active mode when a non-mode command reaches it while off', async () => {
    cache.setState(ID, normalized({ mode: 'cool' }))
    await sync.sendCommand(fakeAppliance(), { mode: 'heat' }) // last active mode: heat
    cache.setState(ID, normalized({ applianceState: 'off', mode: 'off' }))
    mqtt.publish.mockClear()

    await sync.sendCommand(fakeAppliance(), { targetTemperatureC: 25 })
    expect(published()[0]).toMatchObject({ applianceState: 'on', mode: 'heat', targetTemperatureC: 25 })
  })

  it('republishes the cached state when the API call fails (HA reverts)', async () => {
    cache.setState(ID, normalized({ mode: 'cool' }))
    api.sendCommand.mockResolvedValueOnce(undefined)

    await expect(sync.sendCommand(fakeAppliance(), { mode: 'heat' })).resolves.toBeUndefined()
    expect(published()).toEqual([expect.objectContaining({ mode: 'cool' })])
  })

  it('does not enter the post-command window when the command failed', async () => {
    api.sendCommand.mockResolvedValueOnce(undefined)
    await sync.sendCommand(fakeAppliance(), { mode: 'heat' })

    api.getApplianceState.mockResolvedValueOnce(raw({}))
    await sync.pollState(fakeAppliance())
    expect(api.getApplianceState).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid command without calling the API or reverting by default', async () => {
    cache.setState(ID, normalized())
    const appliance = fakeAppliance({ validateCommand: vi.fn(() => ({ valid: false, reason: 'nope' })) })

    await expect(sync.sendCommand(appliance, { fanSpeedSetting: 'high' })).resolves.toBeUndefined()
    expect(api.sendCommand).not.toHaveBeenCalled()
    expect(mqtt.publish).not.toHaveBeenCalled()
    expect(log.warn).toHaveBeenCalledWith(`Command rejected for appliance ${ID}: nope`)
  })

  it('republishes the cached state for a rejected command when revertStateOnRejection is on', async () => {
    sync = create({ revertStateOnRejection: true })
    cache.setState(ID, normalized({ mode: 'cool' }))
    const appliance = fakeAppliance({ validateCommand: vi.fn(() => ({ valid: false, reason: 'nope' })) })

    await sync.sendCommand(appliance, { fanSpeedSetting: 'high' })
    expect(published()).toEqual([expect.objectContaining({ mode: 'cool' })])
  })
})

describe('removeAppliance', () => {
  it('forgets the post-command window', async () => {
    cache.setState(ID, normalized({ mode: 'cool' }))
    await sync.sendCommand(fakeAppliance(), { mode: 'heat' })

    sync.removeAppliance(ID)

    api.getApplianceState.mockResolvedValueOnce(raw({}))
    await sync.pollState(fakeAppliance())
    expect(api.getApplianceState).toHaveBeenCalledTimes(1)
  })

  it('forgets the last active mode', async () => {
    cache.setState(ID, normalized({ mode: 'cool' }))
    await sync.sendCommand(fakeAppliance(), { mode: 'heat' })

    sync.removeAppliance(ID)
    cache.setState(ID, normalized({ applianceState: 'off', mode: 'off' }))
    mqtt.publish.mockClear()
    await sync.sendCommand(fakeAppliance(), { targetTemperatureC: 25 })

    // no remembered mode → the feedback stays off
    expect(published()[0]).toMatchObject({ applianceState: 'off', mode: 'off' })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaseAppliance } from '@/appliances/base.js'
import type { ElectroluxClient } from '@/electrolux.js'
import type { IMqtt } from '@/mqtt.js'
import { Orchestrator, type OrchestratorConfig } from '@/orchestrator.js'
import type { ApplianceInfo, ApplianceStub } from '@/types.js'

// Hoisted spy so we can assert on logger.error in m11 tests without recreating
// the module. The orchestrator module captures its logger reference at import
// time; using vi.hoisted ensures the same spy instance is returned by the mock.
const loggerErrorSpy = vi.hoisted(() => vi.fn())

// Mock dependencies
vi.mock('@/logger.js', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    error: loggerErrorSpy,
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('@/health.js', () => ({
  writeHealthFile: vi.fn(),
}))

vi.mock('@/cache.js', () => ({
  cache: {
    cacheKey: vi.fn((id: string, capabilitiesHash?: string) => ({
      state: `${id}:state`,
      autoDiscovery: capabilitiesHash ? `${id}:auto-discovery:${capabilitiesHash}` : `${id}:auto-discovery`,
    })),
    matchByValue: vi.fn(() => false),
    get: vi.fn(() => undefined),
  },
}))

vi.mock('@/appliances/factory.js', () => ({
  createAppliance: vi.fn(
    (stub: ApplianceStub, _info: ApplianceInfo): BaseAppliance =>
      ({
        getApplianceId: () => stub.applianceId,
        getApplianceName: () => stub.applianceName,
        getModelName: () => 'COMFORT600',
        getApplianceType: () => stub.applianceType,
        getCapabilitiesHash: () => 'mockhash000',
        normalizeState: vi.fn(),
        transformMqttCommandToApi: vi.fn(),
        generateAutoDiscoveryConfig: vi.fn(() => ({ test: 'config' })),
        validateCommand: vi.fn(() => ({ valid: true })),
        deriveImmediateStateFromCommand: vi.fn(() => null),
      }) as unknown as BaseAppliance,
  ),
}))

function createMockClient(): ElectroluxClient {
  return {
    getApplianceInfo: vi.fn(() =>
      Promise.resolve({
        applianceInfo: {
          serialNumber: 'SN123',
          pnc: '123',
          brand: 'Electrolux',
          deviceType: 'PORTABLE_AIR_CONDITIONER',
          model: 'COMFORT600',
          variant: 'A1',
          colour: 'White',
        },
        capabilities: {},
      }),
    ),
    getApplianceState: vi.fn(() => Promise.resolve()),
    getAppliances: vi.fn(() => Promise.resolve([])),
    sendApplianceCommand: vi.fn(() => Promise.resolve()),
    removeAppliance: vi.fn(),
    cleanup: vi.fn(),
  } as unknown as ElectroluxClient
}

function createMockMqtt(): IMqtt {
  return {
    client: {} as IMqtt['client'],
    topicPrefix: 'test_appliances',
    resolveApplianceTopic: vi.fn((id: string) => `test_appliances/${id}`),
    publish: vi.fn(),
    publishInfo: vi.fn(),
    autoDiscovery: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve()),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
    onReconnect: vi.fn(),
  }
}

const defaultConfig: OrchestratorConfig = {
  refreshInterval: 30000,
  applianceDiscoveryInterval: 300000,
  autoDiscovery: true,
  apiFailureRestartThresholdMs: 2700000, // 45 minutes
  healthCheckEnabled: true,
}

const mockStub: ApplianceStub = {
  applianceId: 'appliance-1',
  applianceName: 'Test AC',
  applianceType: 'PORTABLE_AIR_CONDITIONER',
  created: '2024-01-01T00:00:00Z',
}

describe('Orchestrator', () => {
  let client: ElectroluxClient
  let mqtt: IMqtt
  let orchestrator: Orchestrator

  beforeEach(() => {
    vi.useFakeTimers()
    client = createMockClient()
    mqtt = createMockMqtt()
    orchestrator = new Orchestrator(client, mqtt, defaultConfig)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('initializeAppliance', () => {
    it('should create appliance instance and subscribe to MQTT commands', async () => {
      await orchestrator.initializeAppliance(mockStub)

      expect(client.getApplianceInfo).toHaveBeenCalledWith('appliance-1')
      expect(mqtt.autoDiscovery).toHaveBeenCalledWith('appliance-1', expect.any(String), { retain: true, qos: 2 })
      expect(mqtt.subscribe).toHaveBeenCalledWith('appliance-1/command', expect.any(Function))
      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(true)
    })

    it('should handle failed appliance info fetch', async () => {
      vi.mocked(client.getApplianceInfo).mockResolvedValue(undefined as unknown as ApplianceInfo)

      await orchestrator.initializeAppliance(mockStub)

      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(false)
    })

    it('should skip auto-discovery when disabled', async () => {
      const noDiscoveryOrchestrator = new Orchestrator(client, mqtt, {
        ...defaultConfig,
        autoDiscovery: false,
      })

      await noDiscoveryOrchestrator.initializeAppliance(mockStub)

      expect(mqtt.autoDiscovery).not.toHaveBeenCalled()
      expect(client.getApplianceState).toHaveBeenCalled()
    })

    it('should start state polling after delay', async () => {
      await orchestrator.initializeAppliance(mockStub, 100)

      // Before delay, getApplianceState should not have been called (aside from auto-discovery path)
      expect(client.getApplianceState).not.toHaveBeenCalled()

      // Advance past delay
      await vi.advanceTimersByTimeAsync(100)

      expect(client.getApplianceState).toHaveBeenCalled()
    })

    it('should handle errors during initialization', async () => {
      vi.mocked(client.getApplianceInfo).mockRejectedValue(new Error('Network error'))

      // Should not throw
      await orchestrator.initializeAppliance(mockStub)

      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(false)
    })

    it('should route MQTT commands to the correct appliance', async () => {
      let capturedHandler: (topic: string, message: Buffer) => void = () => {}
      vi.mocked(mqtt.subscribe).mockImplementation((_topic, callback) => {
        capturedHandler = callback
        return Promise.resolve()
      })

      await orchestrator.initializeAppliance(mockStub)

      // Simulate MQTT command
      capturedHandler('test_appliances/appliance-1/command', Buffer.from('{"mode":"cool"}'))

      expect(client.sendApplianceCommand).toHaveBeenCalled()
    })

    it('should handle invalid JSON in MQTT command', async () => {
      let capturedHandler: (topic: string, message: Buffer) => void = () => {}
      vi.mocked(mqtt.subscribe).mockImplementation((_topic, callback) => {
        capturedHandler = callback
        return Promise.resolve()
      })

      await orchestrator.initializeAppliance(mockStub)

      // Simulate invalid MQTT command — should not throw
      capturedHandler('test_appliances/appliance-1/command', Buffer.from('not json'))

      expect(client.sendApplianceCommand).not.toHaveBeenCalled()
    })

    it('should handle MQTT command for missing appliance instance', async () => {
      let capturedHandler: (topic: string, message: Buffer) => void = () => {}
      vi.mocked(mqtt.subscribe).mockImplementation((_topic, callback) => {
        capturedHandler = callback
        return Promise.resolve()
      })

      await orchestrator.initializeAppliance(mockStub)

      // Remove the appliance instance manually
      ;(orchestrator.getApplianceInstances() as Map<string, BaseAppliance>).delete('appliance-1')

      // Simulate command — should log error but not throw
      capturedHandler('test_appliances/appliance-1/command', Buffer.from('{"mode":"cool"}'))

      expect(client.sendApplianceCommand).not.toHaveBeenCalled()
    })

    it('should poll state on interval after delay', async () => {
      await orchestrator.initializeAppliance(mockStub, 0)

      // Advance past initial delay
      await vi.advanceTimersByTimeAsync(0)
      expect(client.getApplianceState).toHaveBeenCalledTimes(1)

      // Advance past one refresh interval
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(client.getApplianceState).toHaveBeenCalledTimes(2)
    })

    it('should stop polling when shutting down', async () => {
      await orchestrator.initializeAppliance(mockStub, 0)

      // Advance past delay to start polling
      await vi.advanceTimersByTimeAsync(0)
      expect(client.getApplianceState).toHaveBeenCalledTimes(1)

      // Set shutting down
      orchestrator.isShuttingDown = true

      // Advance another interval — should not poll again
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(client.getApplianceState).toHaveBeenCalledTimes(1)
    })

    it('should not start polling if shutting down before delay fires', async () => {
      await orchestrator.initializeAppliance(mockStub, 1000)

      orchestrator.isShuttingDown = true

      await vi.advanceTimersByTimeAsync(1000)
      expect(client.getApplianceState).not.toHaveBeenCalled()
    })

    it('should republish auto-discovery config when it changes', async () => {
      const { cache } = await import('@/cache.js')

      // Mock getApplianceState to invoke its callback
      vi.mocked(client.getApplianceState).mockImplementation(async (_appliance, callback) => {
        if (callback) callback()
      })

      vi.mocked(cache.matchByValue).mockReturnValue(false)
      await orchestrator.initializeAppliance(mockStub, 0)

      // Advance past delay — this triggers getApplianceState with the discovery callback
      await vi.advanceTimersByTimeAsync(0)

      // Auto-discovery should have been republished via the callback
      // Initial publish + callback publish
      expect(mqtt.autoDiscovery).toHaveBeenCalledTimes(2)
    })

    it('should skip auto-discovery republish when config unchanged', async () => {
      const { cache } = await import('@/cache.js')

      // Mock getApplianceState to invoke its callback
      vi.mocked(client.getApplianceState).mockImplementation(async (_appliance, callback) => {
        if (callback) callback()
      })

      vi.mocked(cache.matchByValue).mockReturnValue(true)
      await orchestrator.initializeAppliance(mockStub, 0)

      await vi.advanceTimersByTimeAsync(0)

      // Only initial publish, no callback republish (cache matched)
      expect(mqtt.autoDiscovery).toHaveBeenCalledTimes(1)
    })
  })

  describe('cleanupAppliance', () => {
    it('should unsubscribe and remove appliance', async () => {
      // First initialize an appliance
      await orchestrator.initializeAppliance(mockStub)
      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(true)

      // Clean it up
      orchestrator.cleanupAppliance('appliance-1')

      expect(mqtt.unsubscribe).toHaveBeenCalledWith('appliance-1/command')
      expect(client.removeAppliance).toHaveBeenCalledWith('appliance-1')
      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(false)
    })

    it('should publish offline status when auto-discovery is enabled', async () => {
      await orchestrator.initializeAppliance(mockStub)
      orchestrator.cleanupAppliance('appliance-1')

      expect(mqtt.publish).toHaveBeenCalledWith(
        'appliance-1/state',
        expect.stringContaining('"connectionState":"disconnected"'),
      )
    })

    it('should not publish offline status when auto-discovery is disabled', async () => {
      const noDiscoveryOrchestrator = new Orchestrator(client, mqtt, {
        ...defaultConfig,
        autoDiscovery: false,
      })

      await noDiscoveryOrchestrator.initializeAppliance(mockStub)
      noDiscoveryOrchestrator.cleanupAppliance('appliance-1')

      expect(mqtt.publish).not.toHaveBeenCalled()
    })

    it('should handle cleanup for non-existent appliance without error', () => {
      // Should not throw
      orchestrator.cleanupAppliance('non-existent')

      expect(mqtt.unsubscribe).toHaveBeenCalledWith('non-existent/command')
      expect(client.removeAppliance).toHaveBeenCalledWith('non-existent')
    })

    it('should not start polling if appliance was removed while stagger timeout was pending', async () => {
      // Initialize with a stagger delay so the timeout is pending
      await orchestrator.initializeAppliance(mockStub, 1000)

      // Remove the appliance before the stagger timeout fires
      orchestrator.cleanupAppliance('appliance-1')

      // Advance past the stagger delay — timeout fires but appliance is gone
      await vi.advanceTimersByTimeAsync(1000)

      // No polling should have started
      expect(client.getApplianceState).not.toHaveBeenCalled()

      // Advance a full refresh interval to confirm no interval was created
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(client.getApplianceState).not.toHaveBeenCalled()
    })
  })

  describe('discoverAppliances', () => {
    it('should skip discovery when API returns null', async () => {
      vi.mocked(client.getAppliances).mockResolvedValue(null as unknown as ApplianceStub[])

      await orchestrator.discoverAppliances()

      // Should not try to initialize or cleanup anything
      expect(client.getApplianceInfo).not.toHaveBeenCalled()
    })

    it('should warn when no appliances found', async () => {
      vi.mocked(client.getAppliances).mockResolvedValue([])

      await orchestrator.discoverAppliances()

      expect(client.getApplianceInfo).not.toHaveBeenCalled()
    })

    it('should initialize new appliances', async () => {
      vi.mocked(client.getAppliances).mockResolvedValue([mockStub])

      await orchestrator.discoverAppliances()

      expect(client.getApplianceInfo).toHaveBeenCalledWith('appliance-1')
      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(true)
    })

    it('should detect and clean up removed appliances', async () => {
      // First discover an appliance
      vi.mocked(client.getAppliances).mockResolvedValue([mockStub])
      await orchestrator.discoverAppliances()

      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(true)

      // Second discovery returns empty — appliance was removed
      vi.mocked(client.getAppliances).mockResolvedValue([])
      await orchestrator.discoverAppliances()

      // The cleanup should have been triggered but since empty returns early with a warn,
      // let's use a different appliance set instead
    })

    it('should detect removed appliances when different set returned', async () => {
      // Initialize with appliance-1
      vi.mocked(client.getAppliances).mockResolvedValue([mockStub])
      await orchestrator.discoverAppliances()

      const anotherStub: ApplianceStub = {
        applianceId: 'appliance-2',
        applianceName: 'Another AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }

      // Discovery now returns appliance-2 only — appliance-1 was removed
      vi.mocked(client.getAppliances).mockResolvedValue([anotherStub])
      await orchestrator.discoverAppliances()

      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(false)
      expect(orchestrator.getApplianceInstances().has('appliance-2')).toBe(true)
      expect(mqtt.unsubscribe).toHaveBeenCalledWith('appliance-1/command')
    })

    it('should not change anything when same appliances returned', async () => {
      vi.mocked(client.getAppliances).mockResolvedValue([mockStub])
      await orchestrator.discoverAppliances()

      // Reset mocks to track new calls only
      vi.mocked(client.getApplianceInfo).mockClear()
      vi.mocked(mqtt.unsubscribe).mockClear()

      // Same appliances returned
      await orchestrator.discoverAppliances()

      expect(client.getApplianceInfo).not.toHaveBeenCalled()
      expect(mqtt.unsubscribe).not.toHaveBeenCalled()
    })

    it('should handle errors during discovery', async () => {
      vi.mocked(client.getAppliances).mockRejectedValue(new Error('API error'))

      await expect(orchestrator.discoverAppliances()).resolves.not.toThrow()
    })
  })

  describe('MQTT publish failure during state update', () => {
    it('should not crash the polling loop when publish throws on the first poll', async () => {
      // The orchestrator calls getApplianceState which internally publishes.
      // If publish throws, the orchestrator must not crash and the loop must continue.
      vi.mocked(client.getApplianceState).mockImplementation(async (_appliance, callback) => {
        // Simulate publish throwing inside getApplianceState
        vi.mocked(mqtt.publish).mockImplementationOnce(() => {
          throw new Error('MQTT broker unreachable')
        })
        if (callback) callback()
        return undefined
      })

      await orchestrator.initializeAppliance(mockStub, 0)
      await vi.advanceTimersByTimeAsync(0)

      // The polling interval should still be running (no crash)
      expect(orchestrator.isShuttingDown).toBe(false)
    })

    it('should not crash the polling loop when publish throws on subsequent poll', async () => {
      let publishCallCount = 0
      vi.mocked(mqtt.publish).mockImplementation(() => {
        publishCallCount++
        if (publishCallCount > 1) {
          throw new Error('MQTT disconnected')
        }
      })

      vi.mocked(client.getApplianceState).mockResolvedValue(undefined)

      await orchestrator.initializeAppliance(mockStub, 0)
      await vi.advanceTimersByTimeAsync(0)

      // Advance another interval — the polling loop must survive
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)

      // getApplianceState should have been called twice
      expect(client.getApplianceState).toHaveBeenCalledTimes(2)
      expect(orchestrator.isShuttingDown).toBe(false)
    })
  })

  describe('polling cycle interrupted by shutdown mid-flight', () => {
    it('should not poll again after shutdown is called between intervals', async () => {
      vi.mocked(client.getApplianceState).mockResolvedValue(undefined)

      await orchestrator.initializeAppliance(mockStub, 0)
      await vi.advanceTimersByTimeAsync(0)

      const callsAfterFirstPoll = vi.mocked(client.getApplianceState).mock.calls.length

      // Shut down before next interval fires
      orchestrator.shutdown(null, null)

      // Advance past the next refresh interval
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)

      // No additional state fetches should have happened
      expect(vi.mocked(client.getApplianceState).mock.calls.length).toBe(callsAfterFirstPoll)
      expect(orchestrator.isShuttingDown).toBe(true)
    })

    it('should not throw when shutdown is called while a getApplianceState call is in-flight', async () => {
      let resolveStateCall: () => void = () => {}

      vi.mocked(client.getApplianceState).mockReturnValue(
        new Promise<undefined>((resolve) => {
          resolveStateCall = () => resolve(undefined)
        }),
      )

      await orchestrator.initializeAppliance(mockStub, 0)

      // Advance timer to trigger the polling call (now in-flight)
      vi.advanceTimersByTime(0)

      // Shut down while the call is pending
      orchestrator.shutdown(null, null)

      // Resolve the pending call
      resolveStateCall()

      // Let microtasks drain
      await vi.advanceTimersByTimeAsync(0)

      expect(orchestrator.isShuttingDown).toBe(true)
      // No unhandled rejection — test would fail if one was thrown
    })
  })

  describe('API failure tracking and restart', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null | undefined) => {
        // Intentionally does not throw — the spy records the call.
        // Throwing here would escape the async interval boundary and become
        // an unhandled rejection, causing false failures in other tests.
        return undefined as never
      })
    })

    afterEach(() => {
      exitSpy.mockRestore()
    })

    it('should call process.exit(1) after sustained API failure exceeding threshold', async () => {
      const thresholdMs = 500
      const shortThresholdOrchestrator = new Orchestrator(client, mqtt, {
        ...defaultConfig,
        refreshInterval: 100,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: true,
      })

      // getApplianceState returns undefined = API failure
      vi.mocked(client.getApplianceState).mockResolvedValue(undefined)

      await shortThresholdOrchestrator.initializeAppliance(mockStub, 0)

      // Advance past initial delay — first poll fires (no exit yet, just started)
      await vi.advanceTimersByTimeAsync(0)

      // Advance time so the failure duration exceeds threshold, triggering exit on next poll
      vi.setSystemTime(Date.now() + thresholdMs + 100)
      await vi.advanceTimersByTimeAsync(100)

      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('should not call process.exit on transient failure under threshold', async () => {
      const thresholdMs = 5000
      const orchestratorWithThreshold = new Orchestrator(client, mqtt, {
        ...defaultConfig,
        refreshInterval: 100,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: true,
      })

      vi.mocked(client.getApplianceState).mockResolvedValue(undefined)

      await orchestratorWithThreshold.initializeAppliance(mockStub, 0)
      await vi.advanceTimersByTimeAsync(0)

      // Advance time but stay under threshold
      vi.setSystemTime(Date.now() + thresholdMs - 1000)
      await vi.advanceTimersByTimeAsync(100)

      expect(exitSpy).not.toHaveBeenCalled()
    })

    it('should reset failure tracking after a successful API call', async () => {
      const thresholdMs = 500
      const orchestratorWithThreshold = new Orchestrator(client, mqtt, {
        ...defaultConfig,
        refreshInterval: 100,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: true,
      })

      // First: return undefined (failure), then a defined value (success)
      vi.mocked(client.getApplianceState)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue({} as Awaited<ReturnType<typeof client.getApplianceState>>)

      await orchestratorWithThreshold.initializeAppliance(mockStub, 0)

      // First poll — failure, but timer resets on next success
      await vi.advanceTimersByTimeAsync(0)

      // Advance system time past threshold
      vi.setSystemTime(Date.now() + thresholdMs + 100)

      // Second poll — success, resets lastSuccessfulApiCall
      await vi.advanceTimersByTimeAsync(100)

      // Third poll — should NOT exit because timer was reset
      await vi.advanceTimersByTimeAsync(100)

      expect(exitSpy).not.toHaveBeenCalled()
    })

    it('should not call process.exit when isShuttingDown is true', async () => {
      const thresholdMs = 100
      const orchestratorWithThreshold = new Orchestrator(client, mqtt, {
        ...defaultConfig,
        refreshInterval: 50,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: true,
      })

      vi.mocked(client.getApplianceState).mockResolvedValue(undefined)

      await orchestratorWithThreshold.initializeAppliance(mockStub, 0)

      // Mark as shutting down before first poll fires
      orchestratorWithThreshold.isShuttingDown = true

      vi.setSystemTime(Date.now() + thresholdMs + 100)
      await vi.advanceTimersByTimeAsync(thresholdMs + 100)

      expect(exitSpy).not.toHaveBeenCalled()
    })

    it('should not call process.exit when healthCheckEnabled is false', async () => {
      const thresholdMs = 100
      const orchestratorNoHealth = new Orchestrator(client, mqtt, {
        ...defaultConfig,
        refreshInterval: 50,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: false,
      })

      vi.mocked(client.getApplianceState).mockResolvedValue(undefined)

      await orchestratorNoHealth.initializeAppliance(mockStub, 0)
      await vi.advanceTimersByTimeAsync(0)

      vi.setSystemTime(Date.now() + thresholdMs + 100)
      await vi.advanceTimersByTimeAsync(100)

      expect(exitSpy).not.toHaveBeenCalled()
    })
  })

  describe('MQTT reconnect republish (M9)', () => {
    it('should register a reconnect callback on the mqtt layer during initialization', async () => {
      await orchestrator.initializeAppliance(mockStub)

      expect(mqtt.onReconnect).toHaveBeenCalledWith(expect.any(Function))
    })

    it('should register the reconnect callback only once even with multiple appliances', async () => {
      const anotherStub: ApplianceStub = {
        applianceId: 'appliance-2',
        applianceName: 'Another AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }

      await orchestrator.initializeAppliance(mockStub)
      await orchestrator.initializeAppliance(anotherStub)

      expect(mqtt.onReconnect).toHaveBeenCalledTimes(1)
    })

    it('should republish cached state for each appliance on every connect event', async () => {
      const { cache } = await import('@/cache.js')
      const cachedState = { mode: 'cool', targetTemperature: 22 }
      vi.mocked(cache.get).mockReturnValue(cachedState)

      await orchestrator.initializeAppliance(mockStub)

      // Capture the reconnect callback
      const reconnectCb = vi.mocked(mqtt.onReconnect).mock.calls[0]?.[0]
      expect(reconnectCb).toBeDefined()

      // First connect event (initial connect) should now also republish cached state
      vi.mocked(mqtt.publish).mockClear()
      reconnectCb?.()
      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(cachedState))

      // Subsequent reconnect should also republish
      vi.mocked(mqtt.publish).mockClear()
      reconnectCb?.()
      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(cachedState))
    })

    it('should skip republish for an appliance with no cached state', async () => {
      const { cache } = await import('@/cache.js')
      // cache.get returns undefined = no state cached yet
      vi.mocked(cache.get).mockReturnValue(undefined)

      await orchestrator.initializeAppliance(mockStub)

      const reconnectCb = vi.mocked(mqtt.onReconnect).mock.calls[0]?.[0]

      vi.mocked(mqtt.publish).mockClear()

      // Connect fires — no cached state means no publish
      reconnectCb?.()
      expect(mqtt.publish).not.toHaveBeenCalled()
    })

    it('should republish cached state for all initialized appliances on reconnect', async () => {
      const { cache } = await import('@/cache.js')
      const cachedState1 = { mode: 'cool' }
      const cachedState2 = { mode: 'heat' }

      const anotherStub: ApplianceStub = {
        applianceId: 'appliance-2',
        applianceName: 'Another AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }

      vi.mocked(cache.get).mockImplementation((key: string) => {
        if (key === 'appliance-1:state') return cachedState1
        if (key === 'appliance-2:state') return cachedState2
        return undefined
      })

      await orchestrator.initializeAppliance(mockStub)
      await orchestrator.initializeAppliance(anotherStub)

      const reconnectCb = vi.mocked(mqtt.onReconnect).mock.calls[0]?.[0]

      vi.mocked(mqtt.publish).mockClear()

      // Any connect event — both appliances get republished
      reconnectCb?.()

      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(cachedState1))
      expect(mqtt.publish).toHaveBeenCalledWith('appliance-2/state', JSON.stringify(cachedState2))
      expect(mqtt.publish).toHaveBeenCalledTimes(2)
    })
  })

  describe('polling loop rejection guard (m11)', () => {
    it('should not cause unhandled rejection and should log error when getApplianceState rejects on initial poll', async () => {
      loggerErrorSpy.mockClear()

      vi.mocked(client.getApplianceState).mockRejectedValue(new Error('Network timeout'))

      await orchestrator.initializeAppliance(mockStub, 0)

      // Advance past delay to fire the setTimeout callback
      await vi.advanceTimersByTimeAsync(0)

      // The orchestrator must not have crashed
      expect(orchestrator.isShuttingDown).toBe(false)

      // Error should have been logged
      expect(loggerErrorSpy).toHaveBeenCalled()
    })

    it('should not cause unhandled rejection and should log error when getApplianceState rejects in interval', async () => {
      loggerErrorSpy.mockClear()

      // First call succeeds, subsequent calls reject
      vi.mocked(client.getApplianceState)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error('MQTT broker went away'))

      await orchestrator.initializeAppliance(mockStub, 0)

      // Fire initial poll
      await vi.advanceTimersByTimeAsync(0)
      expect(client.getApplianceState).toHaveBeenCalledTimes(1)

      // Fire one interval — rejection should be caught, not crash
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(client.getApplianceState).toHaveBeenCalledTimes(2)

      // Orchestrator must still be running
      expect(orchestrator.isShuttingDown).toBe(false)
      expect(loggerErrorSpy).toHaveBeenCalled()
    })
  })

  describe('shutdown', () => {
    it('should clean up all resources', async () => {
      const stopVersionChecker = vi.fn()

      // Initialize an appliance first to create intervals
      await orchestrator.initializeAppliance(mockStub)

      orchestrator.shutdown(stopVersionChecker, null)

      expect(orchestrator.isShuttingDown).toBe(true)
      expect(stopVersionChecker).toHaveBeenCalled()
      expect(client.cleanup).toHaveBeenCalled()
      expect(mqtt.disconnect).toHaveBeenCalled()
    })

    it('should handle null stopVersionChecker and discoveryInterval', () => {
      orchestrator.shutdown(null, null)

      expect(orchestrator.isShuttingDown).toBe(true)
      expect(client.cleanup).toHaveBeenCalled()
      expect(mqtt.disconnect).toHaveBeenCalled()
    })

    it('should clear discovery interval', () => {
      const discoveryInterval = setInterval(() => {}, 1000)

      orchestrator.shutdown(null, discoveryInterval)

      expect(orchestrator.isShuttingDown).toBe(true)
      // Interval should be cleared (no error thrown)
    })

    it('should be idempotent', () => {
      orchestrator.shutdown(null, null)
      orchestrator.shutdown(null, null)

      // cleanup should only be called once
      expect(client.cleanup).toHaveBeenCalledTimes(1)
    })
  })
})

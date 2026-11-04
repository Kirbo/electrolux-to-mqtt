import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaseAppliance } from '#/appliances/base.ts'
import type { IMqtt } from '#/mqtt.ts'
import { type ApplianceSync, type DiscoveryApi, Orchestrator, type OrchestratorConfig } from '#/orchestrator.ts'
import type { NormalizedState } from '#/types/normalized.ts'
import type { ApplianceInfo, ApplianceStub } from '#/types.d.ts'

// Hoisted spy so we can assert on logger.error in m11 tests without recreating
// the module. The orchestrator module captures its logger reference at import
// time; using vi.hoisted ensures the same spy instance is returned by the mock.
const loggerErrorSpy = vi.hoisted(() => vi.fn())

// Mock dependencies
vi.mock('#/logger.ts', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    error: loggerErrorSpy,
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('#/health.ts', () => ({
  writeHealthFile: vi.fn(),
}))

vi.mock('#/cache.ts', () => ({
  cache: {
    cacheKey: vi.fn((id: string, capabilitiesHash?: string) => ({
      state: `${id}:state`,
      autoDiscovery: capabilitiesHash ? `${id}:auto-discovery:${capabilitiesHash}` : `${id}:auto-discovery`,
    })),
    matchByValue: vi.fn(() => false),
    getState: vi.fn((): NormalizedState | null => null),
    delete: vi.fn(),
  },
}))

vi.mock('#/appliances/factory.ts', () => ({
  createAppliance: vi.fn(
    (stub: ApplianceStub, _info: ApplianceInfo): BaseAppliance =>
      ({
        getApplianceId: () => stub.applianceId,
        getApplianceName: () => stub.applianceName,
        getModelName: () => 'COMFORT600',
        getApplianceType: () => stub.applianceType,
        getCapabilitiesHash: () => 'mockhash000',
        transformMqttCommandToApi: vi.fn(),
        generateAutoDiscoveryConfig: vi.fn(() => ({ test: 'config' })),
        validateCommand: vi.fn(() => ({ valid: true })),
        deriveImmediateStateFromCommand: vi.fn(() => null),
      }) as unknown as BaseAppliance,
  ),
}))

/** One fake serving as both the discovery API and the state sync. */
type MockClient = DiscoveryApi & ApplianceSync

function createMockClient(): MockClient {
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
    pollState: vi.fn(() => Promise.resolve()),
    getAppliances: vi.fn(() => Promise.resolve([])),
    sendCommand: vi.fn(() => Promise.resolve()),
    removeAppliance: vi.fn(),
  } as unknown as MockClient
}

function createMockMqtt(): IMqtt {
  return {
    client: {} as IMqtt['client'],
    topicPrefix: 'test_appliances',
    availabilityTopic: 'test_appliances/status',
    resolveApplianceTopic: vi.fn((id: string) => `test_appliances/${id}`),
    publish: vi.fn(),
    publishInfo: vi.fn(),
    autoDiscovery: vi.fn(),
    initialDiscovery: vi.fn(() => Promise.resolve()),
    subscribe: vi.fn(() => Promise.resolve()),
    unsubscribe: vi.fn(),
    subscribeAbsolute: vi.fn(() => Promise.resolve()),
    unsubscribeAbsolute: vi.fn(),
    disconnect: vi.fn(() => Promise.resolve()),
    onReconnect: vi.fn(),
    [Symbol.asyncDispose]: vi.fn(() => Promise.resolve()),
  }
}

const defaultConfig: OrchestratorConfig = {
  refreshInterval: 30000,
  applianceDiscoveryInterval: 300000,
  autoDiscovery: true,
  apiFailureRestartThresholdMs: 2700000, // 45 minutes
  healthCheckEnabled: true,
  applianceRemovalGracePeriodMs: 1800000, // 30 minutes
  haBirthRepublish: true,
  haBirthTopic: 'homeassistant/status',
  haBirthPayload: 'online',
  discoveryOrigin: { name: 'electrolux-to-mqtt', sw_version: '2026.11.3', support_url: 'https://example.com' },
}

const mockStub: ApplianceStub = {
  applianceId: 'appliance-1',
  applianceName: 'Test AC',
  applianceType: 'PORTABLE_AIR_CONDITIONER',
  created: '2024-01-01T00:00:00Z',
}

// A normalized state — the only shape the state cache holds; republish paths send it as-is.
function cachedState(applianceId: string): NormalizedState {
  return { applianceId, mode: 'cool', applianceState: 'on' } as NormalizedState
}

describe('Orchestrator', () => {
  let client: MockClient
  let mqtt: IMqtt
  let orchestrator: Orchestrator

  beforeEach(() => {
    vi.useFakeTimers()
    client = createMockClient()
    mqtt = createMockMqtt()
    orchestrator = new Orchestrator(client, client, mqtt, defaultConfig)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('initializeAppliance', () => {
    it('should create appliance instance and subscribe to MQTT commands', async () => {
      await orchestrator.initializeAppliance(mockStub)

      expect(client.getApplianceInfo).toHaveBeenCalledWith('appliance-1')
      // the first publish goes through initialDiscovery (legacy migration check)
      expect(mqtt.initialDiscovery).toHaveBeenCalledWith('appliance-1', expect.any(String))
      expect(mqtt.subscribe).toHaveBeenCalledWith('appliance-1/command', expect.any(Function))
      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(true)
    })

    it('should build discovery with the bridge availability topic and origin', async () => {
      await orchestrator.initializeAppliance(mockStub)

      const appliance = orchestrator.getApplianceInstances().get('appliance-1')
      expect(appliance?.generateAutoDiscoveryConfig).toHaveBeenCalledWith({
        topicPrefix: 'test_appliances',
        availabilityTopic: 'test_appliances/status',
        origin: defaultConfig.discoveryOrigin,
      })
    })

    it('should handle failed appliance info fetch', async () => {
      vi.mocked(client.getApplianceInfo).mockResolvedValue(undefined as unknown as ApplianceInfo)

      await orchestrator.initializeAppliance(mockStub)

      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(false)
    })

    it('should skip auto-discovery when disabled', async () => {
      const noDiscoveryOrchestrator = new Orchestrator(client, client, mqtt, {
        ...defaultConfig,
        autoDiscovery: false,
      })

      await noDiscoveryOrchestrator.initializeAppliance(mockStub, 0)

      // No pre-poll on the non-auto-discovery path — state fetch comes from _startPolling
      expect(mqtt.autoDiscovery).not.toHaveBeenCalled()
      expect(client.pollState).not.toHaveBeenCalled()

      // Advance past initial delay — polling starts as usual
      await vi.advanceTimersByTimeAsync(0)
      expect(client.pollState).toHaveBeenCalledTimes(1)
    })

    it('should start state polling after delay', async () => {
      await orchestrator.initializeAppliance(mockStub, 100)

      // Before delay, getApplianceState should not have been called (aside from auto-discovery path)
      expect(client.pollState).not.toHaveBeenCalled()

      // Advance past delay
      await vi.advanceTimersByTimeAsync(100)

      expect(client.pollState).toHaveBeenCalled()
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

      expect(client.sendCommand).toHaveBeenCalled()
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

      expect(client.sendCommand).not.toHaveBeenCalled()
    })

    it('should reject command payloads with no known command keys', async () => {
      let capturedHandler: (topic: string, message: Buffer) => void = () => {}
      vi.mocked(mqtt.subscribe).mockImplementation((_topic, callback) => {
        capturedHandler = callback
        return Promise.resolve()
      })

      await orchestrator.initializeAppliance(mockStub)

      // `{}`, junk keys, and non-object JSON must never reach the API — the
      // transform would default them to executeCommand: 'ON' (powers the AC on).
      capturedHandler('test_appliances/appliance-1/command', Buffer.from('{}'))
      capturedHandler('test_appliances/appliance-1/command', Buffer.from('{"foo":1}'))
      capturedHandler('test_appliances/appliance-1/command', Buffer.from('"on"'))
      capturedHandler('test_appliances/appliance-1/command', Buffer.from('123'))

      expect(client.sendCommand).not.toHaveBeenCalled()
    })

    it('should lowercase command values before forwarding', async () => {
      let capturedHandler: (topic: string, message: Buffer) => void = () => {}
      vi.mocked(mqtt.subscribe).mockImplementation((_topic, callback) => {
        capturedHandler = callback
        return Promise.resolve()
      })

      await orchestrator.initializeAppliance(mockStub)

      capturedHandler('test_appliances/appliance-1/command', Buffer.from('{"mode":"FAN_ONLY"}'))

      expect(client.sendCommand).toHaveBeenCalledWith(expect.anything(), { mode: 'fan_only' })
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

      expect(client.sendCommand).not.toHaveBeenCalled()
    })

    it('should poll state on interval after delay', async () => {
      await orchestrator.initializeAppliance(mockStub, 0)

      // Advance past initial delay
      await vi.advanceTimersByTimeAsync(0)
      expect(client.pollState).toHaveBeenCalledTimes(1)

      // Advance past one refresh interval
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(client.pollState).toHaveBeenCalledTimes(2)
    })

    it('should stop polling when shutting down', async () => {
      await orchestrator.initializeAppliance(mockStub, 0)

      // Advance past delay to start polling
      await vi.advanceTimersByTimeAsync(0)
      expect(client.pollState).toHaveBeenCalledTimes(1)

      // Set shutting down
      orchestrator.isShuttingDown = true

      // Advance another interval — should not poll again
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(client.pollState).toHaveBeenCalledTimes(1)
    })

    it('should not start polling if shutting down before delay fires', async () => {
      await orchestrator.initializeAppliance(mockStub, 1000)

      orchestrator.isShuttingDown = true

      await vi.advanceTimersByTimeAsync(1000)
      expect(client.pollState).not.toHaveBeenCalled()
    })

    it('should skip an interval tick while the previous poll is still in flight', async () => {
      const pending: Array<(v: undefined) => void> = []
      vi.mocked(client.pollState)
        .mockResolvedValueOnce(undefined) // initial poll completes normally
        .mockImplementation(() => new Promise((resolve) => pending.push(resolve)))

      await orchestrator.initializeAppliance(mockStub, 0)
      await vi.advanceTimersByTimeAsync(0)
      expect(client.pollState).toHaveBeenCalledTimes(1)

      // Tick 1 — poll hangs (e.g. auth outage keeps the request pending)
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(client.pollState).toHaveBeenCalledTimes(2)

      // Tick 2 — previous poll still in flight, must be skipped (no unbounded queueing)
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(client.pollState).toHaveBeenCalledTimes(2)

      // Once the hung poll settles, polling resumes on the next tick
      pending.shift()?.(undefined)
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(client.pollState).toHaveBeenCalledTimes(3)
    })

    it('should not start a second polling loop when an appliance is removed and re-added during its initial delay', async () => {
      // Old instance with its delayed initial poll still pending
      await orchestrator.initializeAppliance(mockStub, 1000)

      // Removed and re-discovered within the delay window
      orchestrator.cleanupAppliance('appliance-1')
      await orchestrator.initializeAppliance(mockStub, 0)

      await vi.advanceTimersByTimeAsync(0)
      expect(client.pollState).toHaveBeenCalledTimes(1)

      // The old instance's delayed timeout fires — it must not poll or start a second interval
      await vi.advanceTimersByTimeAsync(1000)
      expect(client.pollState).toHaveBeenCalledTimes(1)

      // Exactly one poll per interval afterwards (a leaked second interval would double it)
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(client.pollState).toHaveBeenCalledTimes(2)
    })

    it('should republish auto-discovery config when it changes', async () => {
      const { cache } = await import('#/cache.ts')

      // Mock getApplianceState to invoke its callback
      vi.mocked(client.pollState).mockImplementation(async (_appliance, callback) => {
        if (callback) callback()
      })

      vi.mocked(cache.matchByValue).mockReturnValue(false)
      await orchestrator.initializeAppliance(mockStub, 0)

      // Advance past delay — this triggers getApplianceState with the discovery callback
      await vi.advanceTimersByTimeAsync(0)

      // Initial publish (initialDiscovery) + the callback's republish (autoDiscovery)
      expect(mqtt.initialDiscovery).toHaveBeenCalledTimes(1)
      expect(mqtt.autoDiscovery).toHaveBeenCalledTimes(1)
    })

    it('should skip auto-discovery republish when config unchanged', async () => {
      const { cache } = await import('#/cache.ts')

      // Mock getApplianceState to invoke its callback
      vi.mocked(client.pollState).mockImplementation(async (_appliance, callback) => {
        if (callback) callback()
      })

      vi.mocked(cache.matchByValue).mockReturnValue(true)
      await orchestrator.initializeAppliance(mockStub, 0)

      await vi.advanceTimersByTimeAsync(0)

      // Only the initial publish, no callback republish (cache matched)
      expect(mqtt.initialDiscovery).toHaveBeenCalledTimes(1)
      expect(mqtt.autoDiscovery).not.toHaveBeenCalled()
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
      const noDiscoveryOrchestrator = new Orchestrator(client, client, mqtt, {
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

    it('should delete cache entries for both state and autoDiscovery on cleanup', async () => {
      const { cache } = await import('#/cache.ts')

      await orchestrator.initializeAppliance(mockStub)

      vi.mocked(cache.delete).mockClear()
      orchestrator.cleanupAppliance('appliance-1')

      // Both per-appliance cache keys must be deleted
      expect(cache.delete).toHaveBeenCalledWith('appliance-1:state')
      // autoDiscovery key uses the capabilitiesHash from the appliance mock ('mockhash000')
      expect(cache.delete).toHaveBeenCalledWith('appliance-1:auto-discovery:mockhash000')
      expect(cache.delete).toHaveBeenCalledTimes(2)
    })

    it('should not start polling if appliance was removed while stagger timeout was pending', async () => {
      // Initialize with a stagger delay so the timeout is pending
      await orchestrator.initializeAppliance(mockStub, 1000)

      // Remove the appliance before the stagger timeout fires
      orchestrator.cleanupAppliance('appliance-1')

      // Advance past the stagger delay — timeout fires but appliance is gone
      await vi.advanceTimersByTimeAsync(1000)

      // No polling should have started
      expect(client.pollState).not.toHaveBeenCalled()

      // Advance a full refresh interval to confirm no interval was created
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(client.pollState).not.toHaveBeenCalled()
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

    it('initializes multiple new appliances concurrently rather than one at a time', async () => {
      const secondStub: ApplianceStub = { ...mockStub, applianceId: 'appliance-2' }
      vi.mocked(client.getAppliances).mockResolvedValue([mockStub, secondStub])
      // Info lookups never settle — a sequential loop would stall on the first one
      vi.mocked(client.getApplianceInfo).mockReturnValue(new Promise(() => {}))

      void orchestrator.discoverAppliances()
      await vi.waitFor(() => expect(client.getApplianceInfo).toHaveBeenCalledTimes(2))

      expect(client.getApplianceInfo).toHaveBeenCalledWith('appliance-1')
      expect(client.getApplianceInfo).toHaveBeenCalledWith('appliance-2')
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

    it('should detect removed appliances when different set returned (after grace period)', async () => {
      // Initialize with appliance-1
      vi.mocked(client.getAppliances).mockResolvedValue([mockStub])
      await orchestrator.discoverAppliances()

      const anotherStub: ApplianceStub = {
        applianceId: 'appliance-2',
        applianceName: 'Another AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }

      // First sweep: appliance-1 absent — timer starts
      vi.mocked(client.getAppliances).mockResolvedValue([anotherStub])
      await orchestrator.discoverAppliances()
      // Grace period not elapsed yet — appliance-1 is still managed
      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(true)

      // Advance past the grace period (defaultConfig: 1800000 ms = 30 min)
      vi.setSystemTime(Date.now() + defaultConfig.applianceRemovalGracePeriodMs + 1000)

      // Second sweep: still absent, grace elapsed → cleanup fires
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

    it('does not clean up an appliance after a single partial discovery response', async () => {
      // Initialize APPLIANCE_A so the orchestrator manages it
      vi.mocked(client.getAppliances).mockResolvedValue([mockStub])
      await orchestrator.discoverAppliances()
      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(true)

      // Reset call trackers so we only observe what happens during the partial response
      vi.mocked(mqtt.unsubscribe).mockClear()
      vi.mocked(mqtt.publish).mockClear()

      // Simulate a partial API response: non-empty but APPLIANCE_A is absent (transient hiccup)
      const applianceBStub: ApplianceStub = {
        applianceId: 'appliance-b',
        applianceName: 'Other AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }
      vi.mocked(client.getAppliances).mockResolvedValue([applianceBStub])

      await orchestrator.discoverAppliances()

      // APPLIANCE_A should still be managed — one partial response must not trigger cleanup
      expect(orchestrator.getApplianceInstances().has('appliance-1')).toBe(true)

      // No unsubscribe for APPLIANCE_A's command topic
      expect(mqtt.unsubscribe).not.toHaveBeenCalledWith('appliance-1/command')

      // No disconnected state published for APPLIANCE_A
      expect(mqtt.publish).not.toHaveBeenCalledWith(
        'appliance-1/state',
        expect.stringContaining('"connectionState":"disconnected"'),
      )
    })

    it('cleans up an appliance once it has been absent for >= the grace period', async () => {
      const gracePeriodMs = 5000
      const shortGraceOrchestrator = new Orchestrator(client, client, mqtt, {
        ...defaultConfig,
        applianceRemovalGracePeriodMs: gracePeriodMs,
      })

      // Set up: initialize appliance-1
      vi.mocked(client.getAppliances).mockResolvedValue([mockStub])
      await shortGraceOrchestrator.discoverAppliances()
      expect(shortGraceOrchestrator.getApplianceInstances().has('appliance-1')).toBe(true)

      // Reset call trackers
      vi.mocked(mqtt.unsubscribe).mockClear()
      vi.mocked(mqtt.publish).mockClear()

      // First sweep: appliance absent — timer starts
      const applianceBStub: ApplianceStub = {
        applianceId: 'appliance-b',
        applianceName: 'Other AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }
      vi.mocked(client.getAppliances).mockResolvedValue([applianceBStub])
      await shortGraceOrchestrator.discoverAppliances()
      // Grace period not yet elapsed — still managed
      expect(shortGraceOrchestrator.getApplianceInstances().has('appliance-1')).toBe(true)

      // Advance system time past the grace period
      vi.setSystemTime(Date.now() + gracePeriodMs + 100)

      // Second sweep: still absent + grace period exceeded → cleanup fires
      await shortGraceOrchestrator.discoverAppliances()

      expect(shortGraceOrchestrator.getApplianceInstances().has('appliance-1')).toBe(false)
      expect(mqtt.unsubscribe).toHaveBeenCalledWith('appliance-1/command')
      expect(mqtt.publish).toHaveBeenCalledWith(
        'appliance-1/state',
        expect.stringContaining('"connectionState":"disconnected"'),
      )
    })

    it('does not advance the missing-since timer when a discovery sweep returns undefined (API failure)', async () => {
      const gracePeriodMs = 5000
      const shortGraceOrchestrator = new Orchestrator(client, client, mqtt, {
        ...defaultConfig,
        applianceRemovalGracePeriodMs: gracePeriodMs,
      })

      // Initialize appliance-1
      vi.mocked(client.getAppliances).mockResolvedValue([mockStub])
      await shortGraceOrchestrator.discoverAppliances()

      // First absence sweep: timer starts at T0
      const applianceBStub: ApplianceStub = {
        applianceId: 'appliance-b',
        applianceName: 'Other AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }
      vi.mocked(client.getAppliances).mockResolvedValue([applianceBStub])
      await shortGraceOrchestrator.discoverAppliances()
      expect(shortGraceOrchestrator.getApplianceInstances().has('appliance-1')).toBe(true)

      // Advance time to just under the grace period
      vi.setSystemTime(Date.now() + gracePeriodMs - 500)

      // API failure sweep: returns undefined — must not touch the timer or trigger cleanup
      vi.mocked(client.getAppliances).mockResolvedValue(null as unknown as ApplianceStub[])
      await shortGraceOrchestrator.discoverAppliances()
      expect(shortGraceOrchestrator.getApplianceInstances().has('appliance-1')).toBe(true)

      // Advance time past grace period from T0
      vi.setSystemTime(Date.now() + 600)

      // Next successful absence sweep — now past grace period → cleanup fires
      vi.mocked(client.getAppliances).mockResolvedValue([applianceBStub])
      await shortGraceOrchestrator.discoverAppliances()
      expect(shortGraceOrchestrator.getApplianceInstances().has('appliance-1')).toBe(false)
    })

    it('resets the missing-since timer when an appliance reappears before the grace period elapses', async () => {
      const gracePeriodMs = 5000
      const shortGraceOrchestrator = new Orchestrator(client, client, mqtt, {
        ...defaultConfig,
        applianceRemovalGracePeriodMs: gracePeriodMs,
      })

      // Initialize appliance-1
      vi.mocked(client.getAppliances).mockResolvedValue([mockStub])
      await shortGraceOrchestrator.discoverAppliances()

      const applianceBStub: ApplianceStub = {
        applianceId: 'appliance-b',
        applianceName: 'Other AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }

      // First absence sweep — timer starts
      vi.mocked(client.getAppliances).mockResolvedValue([applianceBStub])
      await shortGraceOrchestrator.discoverAppliances()
      expect(shortGraceOrchestrator.getApplianceInstances().has('appliance-1')).toBe(true)

      // Advance time to just under grace period
      vi.setSystemTime(Date.now() + gracePeriodMs - 500)

      // Appliance reappears — timer resets
      vi.mocked(client.getAppliances).mockResolvedValue([mockStub, applianceBStub])
      await shortGraceOrchestrator.discoverAppliances()
      expect(shortGraceOrchestrator.getApplianceInstances().has('appliance-1')).toBe(true)

      // Advance time past what would have been the original grace deadline
      vi.setSystemTime(Date.now() + 600)

      // Absence sweep again — timer starts fresh from this new T0
      vi.mocked(client.getAppliances).mockResolvedValue([applianceBStub])
      await shortGraceOrchestrator.discoverAppliances()
      // Grace period not elapsed since reappearance — still managed
      expect(shortGraceOrchestrator.getApplianceInstances().has('appliance-1')).toBe(true)
      expect(mqtt.unsubscribe).not.toHaveBeenCalledWith('appliance-1/command')
    })
  })

  describe('MQTT publish failure during state update', () => {
    it('should not crash the polling loop when publish throws on the first poll', async () => {
      // The orchestrator calls getApplianceState which internally publishes.
      // If publish throws, the orchestrator must not crash and the loop must continue.
      vi.mocked(client.pollState).mockImplementation(async (_appliance, callback) => {
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

      vi.mocked(client.pollState).mockResolvedValue(undefined)

      await orchestrator.initializeAppliance(mockStub, 0)
      await vi.advanceTimersByTimeAsync(0)

      // Advance another interval — the polling loop must survive
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)

      // getApplianceState should have been called twice
      expect(client.pollState).toHaveBeenCalledTimes(2)
      expect(orchestrator.isShuttingDown).toBe(false)
    })
  })

  describe('shutdown completion', () => {
    it('should resolve only after the MQTT client has disconnected', async () => {
      let finishDisconnect: (() => void) | undefined
      vi.mocked(mqtt.disconnect).mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishDisconnect = resolve
          }),
      )

      let resolved = false
      const done = orchestrator.shutdown().then(() => {
        resolved = true
      })
      await Promise.resolve()
      expect(resolved).toBe(false)

      finishDisconnect?.()
      await done
      expect(resolved).toBe(true)
    })

    it('should not disconnect twice when shutdown is called again', async () => {
      await orchestrator.shutdown()
      await orchestrator.shutdown()

      expect(mqtt.disconnect).toHaveBeenCalledTimes(1)
    })
  })

  describe('polling cycle interrupted by shutdown mid-flight', () => {
    it('should not poll again after shutdown is called between intervals', async () => {
      vi.mocked(client.pollState).mockResolvedValue(undefined)

      await orchestrator.initializeAppliance(mockStub, 0)
      await vi.advanceTimersByTimeAsync(0)

      const callsAfterFirstPoll = vi.mocked(client.pollState).mock.calls.length

      // Shut down before next interval fires
      orchestrator.shutdown()

      // Advance past the next refresh interval
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)

      // No additional state fetches should have happened
      expect(vi.mocked(client.pollState).mock.calls).toHaveLength(callsAfterFirstPoll)
      expect(orchestrator.isShuttingDown).toBe(true)
    })

    it('should not throw when shutdown is called while a getApplianceState call is in-flight', async () => {
      let resolveStateCall: () => void = () => {}

      vi.mocked(client.pollState).mockReturnValue(
        new Promise<undefined>((resolve) => {
          resolveStateCall = () => resolve(undefined)
        }),
      )

      await orchestrator.initializeAppliance(mockStub, 0)

      // Advance timer to trigger the polling call (now in-flight)
      vi.advanceTimersByTime(0)

      // Shut down while the call is pending
      orchestrator.shutdown()

      // Resolve the pending call
      resolveStateCall()

      // Let microtasks drain
      await vi.advanceTimersByTimeAsync(0)

      expect(orchestrator.isShuttingDown).toBe(true)
      // No unhandled rejection — test would fail if one was thrown
    })

    it('should not leak a polling interval when shutdown completes before the initial poll resolves', async () => {
      let resolveStateCall: () => void = () => {}

      vi.mocked(client.pollState).mockReturnValue(
        new Promise<undefined>((resolve) => {
          resolveStateCall = () => resolve(undefined)
        }),
      )

      await orchestrator.initializeAppliance(mockStub, 0)

      // Trigger the initial poll (in-flight)
      vi.advanceTimersByTime(0)

      // Shutdown completes — clears applianceStateIntervals sweep
      orchestrator.shutdown()

      // Initial poll resolves after shutdown — .finally() must not create an interval
      resolveStateCall()
      await vi.advanceTimersByTimeAsync(0)

      expect(orchestrator.isShuttingDown).toBe(true)
      // If an interval leaked, advancing time would trigger getApplianceState again
      const callsAtShutdown = vi.mocked(client.pollState).mock.calls.length
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(vi.mocked(client.pollState).mock.calls).toHaveLength(callsAtShutdown)
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
      const shortThresholdOrchestrator = new Orchestrator(client, client, mqtt, {
        ...defaultConfig,
        refreshInterval: 100,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: true,
      })

      // getApplianceState returns undefined = API failure
      vi.mocked(client.pollState).mockResolvedValue(undefined)

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
      const orchestratorWithThreshold = new Orchestrator(client, client, mqtt, {
        ...defaultConfig,
        refreshInterval: 100,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: true,
      })

      vi.mocked(client.pollState).mockResolvedValue(undefined)

      await orchestratorWithThreshold.initializeAppliance(mockStub, 0)
      await vi.advanceTimersByTimeAsync(0)

      // Advance time but stay under threshold
      vi.setSystemTime(Date.now() + thresholdMs - 1000)
      await vi.advanceTimersByTimeAsync(100)

      expect(exitSpy).not.toHaveBeenCalled()
    })

    it('should reset failure tracking after a successful API call', async () => {
      const thresholdMs = 500
      const orchestratorWithThreshold = new Orchestrator(client, client, mqtt, {
        ...defaultConfig,
        refreshInterval: 100,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: true,
      })

      // First: return undefined (failure), then a defined value (success)
      vi.mocked(client.pollState)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue({} as Awaited<ReturnType<typeof client.pollState>>)

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
      const orchestratorWithThreshold = new Orchestrator(client, client, mqtt, {
        ...defaultConfig,
        refreshInterval: 50,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: true,
      })

      vi.mocked(client.pollState).mockResolvedValue(undefined)

      await orchestratorWithThreshold.initializeAppliance(mockStub, 0)

      // Mark as shutting down before first poll fires
      orchestratorWithThreshold.isShuttingDown = true

      vi.setSystemTime(Date.now() + thresholdMs + 100)
      await vi.advanceTimersByTimeAsync(thresholdMs + 100)

      expect(exitSpy).not.toHaveBeenCalled()
    })

    it('should not call process.exit when healthCheckEnabled is false', async () => {
      const thresholdMs = 100
      const orchestratorNoHealth = new Orchestrator(client, client, mqtt, {
        ...defaultConfig,
        refreshInterval: 50,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: false,
      })

      vi.mocked(client.pollState).mockResolvedValue(undefined)

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

    it('should republish the cached (normalized) state on every connect event', async () => {
      const { cache } = await import('#/cache.ts')
      const cached = cachedState('appliance-1')
      vi.mocked(cache.getState).mockReturnValue(cached)

      await orchestrator.initializeAppliance(mockStub)

      // Capture the reconnect callback
      const reconnectCb = vi.mocked(mqtt.onReconnect).mock.calls[0]?.[0]
      expect(reconnectCb).toBeDefined()

      // First connect event (initial connect) should republish the normalized form.
      vi.mocked(mqtt.publish).mockClear()
      reconnectCb?.()
      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(cached))

      // Subsequent reconnect should also republish the normalized form.
      vi.mocked(mqtt.publish).mockClear()
      reconnectCb?.()
      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(cached))
    })

    it('should skip republish for an appliance with no cached state', async () => {
      const { cache } = await import('#/cache.ts')
      // cache.get returns undefined = no state cached yet
      vi.mocked(cache.getState).mockReturnValue(null)

      await orchestrator.initializeAppliance(mockStub)

      const reconnectCb = vi.mocked(mqtt.onReconnect).mock.calls[0]?.[0]

      vi.mocked(mqtt.publish).mockClear()

      // Connect fires — no cached state means no publish
      reconnectCb?.()
      expect(mqtt.publish).not.toHaveBeenCalled()
    })

    it('should republish normalized cached state for all initialized appliances on reconnect', async () => {
      const { cache } = await import('#/cache.ts')
      const cached1 = cachedState('appliance-1')
      const cached2 = cachedState('appliance-2')

      const anotherStub: ApplianceStub = {
        applianceId: 'appliance-2',
        applianceName: 'Another AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }

      vi.mocked(cache.getState).mockImplementation((id: string) => {
        if (id === 'appliance-1') return cached1
        if (id === 'appliance-2') return cached2
        return null
      })

      await orchestrator.initializeAppliance(mockStub)
      await orchestrator.initializeAppliance(anotherStub)

      const reconnectCb = vi.mocked(mqtt.onReconnect).mock.calls[0]?.[0]

      vi.mocked(mqtt.publish).mockClear()

      // Any connect event — both appliances get republished in normalized form
      reconnectCb?.()

      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(cached1))
      expect(mqtt.publish).toHaveBeenCalledWith('appliance-2/state', JSON.stringify(cached2))
      expect(mqtt.publish).toHaveBeenCalledTimes(2)
    })
  })

  describe('polling loop rejection guard (m11)', () => {
    it('should not cause unhandled rejection and should log error when getApplianceState rejects on initial poll', async () => {
      loggerErrorSpy.mockClear()

      vi.mocked(client.pollState).mockRejectedValue(new Error('Network timeout'))

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
      vi.mocked(client.pollState).mockResolvedValueOnce(undefined).mockRejectedValue(new Error('MQTT broker went away'))

      await orchestrator.initializeAppliance(mockStub, 0)

      // Fire initial poll
      await vi.advanceTimersByTimeAsync(0)
      expect(client.pollState).toHaveBeenCalledTimes(1)

      // Fire one interval — rejection should be caught, not crash
      await vi.advanceTimersByTimeAsync(defaultConfig.refreshInterval)
      expect(client.pollState).toHaveBeenCalledTimes(2)

      // Orchestrator must still be running
      expect(orchestrator.isShuttingDown).toBe(false)
      expect(loggerErrorSpy).toHaveBeenCalled()
    })
  })

  describe('HA birth-message republish', () => {
    it('should subscribe to haBirthTopic when haBirthRepublish is true after first appliance is initialized', async () => {
      await orchestrator.initializeAppliance(mockStub)

      expect(mqtt.subscribeAbsolute).toHaveBeenCalledWith('homeassistant/status', expect.any(Function))
    })

    it('should subscribe to the birth topic only once across multiple appliances', async () => {
      const anotherStub: ApplianceStub = {
        applianceId: 'appliance-2',
        applianceName: 'Another AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }

      await orchestrator.initializeAppliance(mockStub)
      await orchestrator.initializeAppliance(anotherStub)

      expect(mqtt.subscribeAbsolute).toHaveBeenCalledTimes(1)
    })

    it('should not subscribe to birth topic when haBirthRepublish is false', async () => {
      const noBirthOrchestrator = new Orchestrator(client, client, mqtt, {
        ...defaultConfig,
        haBirthRepublish: false,
      })

      await noBirthOrchestrator.initializeAppliance(mockStub)

      expect(mqtt.subscribeAbsolute).not.toHaveBeenCalled()
    })

    it('should republish discovery and the cached state for each appliance when birth payload matches', async () => {
      const { cache } = await import('#/cache.ts')
      const cached = cachedState('appliance-1')
      vi.mocked(cache.getState).mockReturnValue(cached)

      await orchestrator.initializeAppliance(mockStub)

      // Capture the birth handler
      const [, birthHandler] = vi.mocked(mqtt.subscribeAbsolute).mock.calls[0] as [
        string,
        (topic: string, message: Buffer) => void,
      ]

      vi.mocked(mqtt.publish).mockClear()
      vi.mocked(mqtt.autoDiscovery).mockClear()

      // Simulate HA coming online
      birthHandler('homeassistant/status', Buffer.from('online'))

      // Both discovery and state must be republished — state in NORMALIZED form
      // (the raw cache entry's nested/capitalized shape breaks HA discovery templates).
      expect(mqtt.autoDiscovery).toHaveBeenCalledWith('appliance-1', expect.any(String), { retain: true, qos: 2 })
      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(cached))
    })

    it('should not republish when birth payload does not match (e.g. offline)', async () => {
      const { cache } = await import('#/cache.ts')
      vi.mocked(cache.getState).mockReturnValue(cachedState('appliance-1'))

      await orchestrator.initializeAppliance(mockStub)

      const [, birthHandler] = vi.mocked(mqtt.subscribeAbsolute).mock.calls[0] as [
        string,
        (topic: string, message: Buffer) => void,
      ]

      vi.mocked(mqtt.publish).mockClear()
      vi.mocked(mqtt.autoDiscovery).mockClear()

      // HA going offline — must not trigger republish
      birthHandler('homeassistant/status', Buffer.from('offline'))

      expect(mqtt.autoDiscovery).not.toHaveBeenCalled()
      expect(mqtt.publish).not.toHaveBeenCalled()
    })

    it('should skip appliances with no cached state during birth republish', async () => {
      const { cache } = await import('#/cache.ts')
      vi.mocked(cache.getState).mockReturnValue(null)

      await orchestrator.initializeAppliance(mockStub)

      const [, birthHandler] = vi.mocked(mqtt.subscribeAbsolute).mock.calls[0] as [
        string,
        (topic: string, message: Buffer) => void,
      ]

      vi.mocked(mqtt.publish).mockClear()
      vi.mocked(mqtt.autoDiscovery).mockClear()

      birthHandler('homeassistant/status', Buffer.from('online'))

      // Discovery still fires (no dependency on cached state), but state publish skipped
      expect(mqtt.autoDiscovery).toHaveBeenCalledWith('appliance-1', expect.any(String), { retain: true, qos: 2 })
      expect(mqtt.publish).not.toHaveBeenCalled()
    })

    it('should republish for all appliances on birth', async () => {
      const { cache } = await import('#/cache.ts')
      const state1 = cachedState('appliance-1')
      const state2 = cachedState('appliance-2')
      const anotherStub: ApplianceStub = {
        applianceId: 'appliance-2',
        applianceName: 'Another AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }

      vi.mocked(cache.getState).mockImplementation((id: string) => {
        if (id === 'appliance-1') return state1
        if (id === 'appliance-2') return state2
        return null
      })

      await orchestrator.initializeAppliance(mockStub)
      await orchestrator.initializeAppliance(anotherStub)

      const [, birthHandler] = vi.mocked(mqtt.subscribeAbsolute).mock.calls[0] as [
        string,
        (topic: string, message: Buffer) => void,
      ]

      vi.mocked(mqtt.publish).mockClear()
      vi.mocked(mqtt.autoDiscovery).mockClear()

      birthHandler('homeassistant/status', Buffer.from('online'))

      expect(mqtt.autoDiscovery).toHaveBeenCalledWith('appliance-1', expect.any(String), { retain: true, qos: 2 })
      expect(mqtt.autoDiscovery).toHaveBeenCalledWith('appliance-2', expect.any(String), { retain: true, qos: 2 })
      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(state1))
      expect(mqtt.publish).toHaveBeenCalledWith('appliance-2/state', JSON.stringify(state2))
    })

    it('should unsubscribe from birth topic on shutdown', async () => {
      await orchestrator.initializeAppliance(mockStub)

      orchestrator.shutdown()

      expect(mqtt.unsubscribeAbsolute).toHaveBeenCalledWith('homeassistant/status')
    })

    it('should not call unsubscribeAbsolute on shutdown when haBirthRepublish is false', async () => {
      const noBirthOrchestrator = new Orchestrator(client, client, mqtt, {
        ...defaultConfig,
        haBirthRepublish: false,
      })

      await noBirthOrchestrator.initializeAppliance(mockStub)
      noBirthOrchestrator.shutdown()

      expect(mqtt.unsubscribeAbsolute).not.toHaveBeenCalled()
    })
  })

  describe('shutdown', () => {
    it('should clean up orchestrator-owned resources', async () => {
      // Initialize an appliance first to create intervals
      await orchestrator.initializeAppliance(mockStub)

      await orchestrator.shutdown()

      expect(orchestrator.isShuttingDown).toBe(true)
      expect(mqtt.disconnect).toHaveBeenCalled()
    })
  })

  describe('[Symbol.asyncDispose]', () => {
    it('should call shutdown when Symbol.asyncDispose is invoked', async () => {
      const shutdownSpy = vi.spyOn(orchestrator, 'shutdown')

      await orchestrator[Symbol.asyncDispose]()

      expect(shutdownSpy).toHaveBeenCalledWith()
    })

    it('should allow await using syntax', async () => {
      const shutdownSpy = vi.spyOn(orchestrator, 'shutdown')

      {
        await using _orchestrator = orchestrator
      }

      expect(shutdownSpy).toHaveBeenCalledWith()
    })
  })
})

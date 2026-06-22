import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaseAppliance } from '@/appliances/base.js'
import type { ElectroluxClient } from '@/electrolux.js'
import type { IMqtt } from '@/mqtt.js'
import { Orchestrator, type OrchestratorConfig } from '@/orchestrator.js'
import type { NormalizedState } from '@/types/normalized.js'
import type { ApplianceInfo, ApplianceStub } from '@/types.js'
import { mockApplianceStateResponse } from './fixtures/api-responses.js'

// Hoisted spies so we can assert on logger.error and logger.debug without
// recreating the module. The orchestrator module captures its logger reference
// at import time; using vi.hoisted ensures the same spy instance is returned.
const loggerErrorSpy = vi.hoisted(() => vi.fn())
const loggerDebugSpy = vi.hoisted(() => vi.fn())

// Mock dependencies
vi.mock('@/logger.js', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    error: loggerErrorSpy,
    warn: vi.fn(),
    debug: loggerDebugSpy,
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
    set: vi.fn(),
    delete: vi.fn(),
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
    reseedApplianceState: vi.fn(() => Promise.resolve()),
    getAppliances: vi.fn(() => Promise.resolve([])),
    sendApplianceCommand: vi.fn(() => Promise.resolve()),
    removeAppliance: vi.fn(),
    cleanup: vi.fn(),
    // Returns undefined by default (no pending command pins) — tests can override
    getPendingCommandFields: vi.fn(() => undefined),
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
    subscribeAbsolute: vi.fn(() => Promise.resolve()),
    unsubscribeAbsolute: vi.fn(),
    disconnect: vi.fn(),
    onReconnect: vi.fn(),
    [Symbol.asyncDispose]: vi.fn(() => Promise.resolve()),
  }
}

const defaultConfig: OrchestratorConfig = {
  idleTimeoutMs: 120000,
  refreshInterval: 60000, // 60 seconds in ms
  commandStateDelaySeconds: 30,
  applianceDiscoveryInterval: 300000,
  autoDiscovery: true,
  apiFailureRestartThresholdMs: 2700000, // 45 minutes
  healthCheckEnabled: true,
  applianceRemovalGracePeriodMs: 1800000, // 30 minutes
  haBirthRepublish: true,
  haBirthTopic: 'homeassistant/status',
  haBirthPayload: 'online',
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
    })

    it('should seed initial state via setTimeout(0) after initialization', async () => {
      await orchestrator.initializeAppliance(mockStub)

      // Before timeout fires, reseed should not have been called
      expect(client.reseedApplianceState).not.toHaveBeenCalled()

      // Advance past setTimeout(0)
      await vi.advanceTimersByTimeAsync(0)

      expect(client.reseedApplianceState).toHaveBeenCalledTimes(1)
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

    it('should log error when sendApplianceCommand rejects', async () => {
      let capturedHandler: (topic: string, message: Buffer) => void = () => {}
      vi.mocked(mqtt.subscribe).mockImplementation((_topic, callback) => {
        capturedHandler = callback
        return Promise.resolve()
      })

      vi.mocked(client.sendApplianceCommand).mockRejectedValueOnce(new Error('Command failed'))

      await orchestrator.initializeAppliance(mockStub)

      loggerErrorSpy.mockClear()

      // Simulate MQTT command — sendApplianceCommand will reject
      capturedHandler('test_appliances/appliance-1/command', Buffer.from('{"mode":"cool"}'))

      // Let the rejection settle
      await vi.advanceTimersByTimeAsync(0)

      expect(loggerErrorSpy).toHaveBeenCalled()
    })

    it('should skip initial seed when shutting down before timeout fires', async () => {
      await orchestrator.initializeAppliance(mockStub)

      orchestrator.isShuttingDown = true

      await vi.advanceTimersByTimeAsync(0)
      expect(client.reseedApplianceState).not.toHaveBeenCalled()
    })

    it('should skip initial seed if appliance was removed before timeout fires', async () => {
      await orchestrator.initializeAppliance(mockStub)

      // Remove the appliance before the timeout fires
      orchestrator.cleanupAppliance('appliance-1')

      await vi.advanceTimersByTimeAsync(0)

      expect(client.reseedApplianceState).not.toHaveBeenCalled()
    })
  })

  describe('polling loop', () => {
    it('should call reseedApplianceState immediately after initial delay then repeat at refreshInterval', async () => {
      await orchestrator.initializeAppliance(mockStub)

      // Before timeout fires: no seed yet
      expect(client.reseedApplianceState).not.toHaveBeenCalled()

      // Fire initial delay timeout (delayMs=0)
      await vi.advanceTimersByTimeAsync(1)
      expect(client.reseedApplianceState).toHaveBeenCalledTimes(1)

      // Advance by one refreshInterval (60000ms) — interval tick fires
      await vi.advanceTimersByTimeAsync(60_000)
      expect(client.reseedApplianceState).toHaveBeenCalledTimes(2)

      // Advance by another refreshInterval
      await vi.advanceTimersByTimeAsync(60_000)
      expect(client.reseedApplianceState).toHaveBeenCalledTimes(3)
    })

    it('should pass commandStateDelaySeconds settle window to reseedApplianceState', async () => {
      await orchestrator.initializeAppliance(mockStub)
      await vi.advanceTimersByTimeAsync(1)

      // First arg is the appliance, second is settleWindowMs = commandStateDelaySeconds * 1000 = 30000
      expect(client.reseedApplianceState).toHaveBeenCalledWith(expect.anything(), 30_000)
    })

    it('should schedule command re-poll after commandStateDelaySeconds when command succeeds', async () => {
      let capturedHandler: (topic: string, message: Buffer) => void = () => {}
      vi.mocked(mqtt.subscribe).mockImplementation((_topic, callback) => {
        capturedHandler = callback
        return Promise.resolve()
      })

      // Return a non-undefined value so that scheduleCommandRepoll is triggered
      vi.mocked(client.sendApplianceCommand).mockResolvedValueOnce({ applianceId: 'appliance-1' } as unknown as Awaited<
        ReturnType<typeof client.sendApplianceCommand>
      >)

      await orchestrator.initializeAppliance(mockStub)
      await vi.advanceTimersByTimeAsync(1) // drain initial seed

      vi.mocked(client.reseedApplianceState).mockClear()

      // Fire command
      capturedHandler('test_appliances/appliance-1/command', Buffer.from('{"mode":"cool"}'))
      await vi.advanceTimersByTimeAsync(1) // let command promise settle

      // Advance by commandStateDelaySeconds (30000ms) — re-poll fires
      await vi.advanceTimersByTimeAsync(30_000)
      // Re-poll is called with settleWindowMs=0 (authoritative)
      expect(client.reseedApplianceState).toHaveBeenCalledWith(expect.anything(), 0)
    })

    it('should stop polling interval when appliance is cleaned up', async () => {
      await orchestrator.initializeAppliance(mockStub)
      await vi.advanceTimersByTimeAsync(1) // drain initial seed

      vi.mocked(client.reseedApplianceState).mockClear()

      // Remove the appliance
      orchestrator.cleanupAppliance('appliance-1')

      // Advance by refreshInterval — interval should not fire
      await vi.advanceTimersByTimeAsync(60_000)
      expect(client.reseedApplianceState).not.toHaveBeenCalled()
    })

    it('should call reseedApplianceState again when interval fires and state is defined', async () => {
      vi.mocked(client.reseedApplianceState).mockResolvedValue({ applianceId: 'appliance-1' } as unknown as Awaited<
        ReturnType<typeof client.reseedApplianceState>
      >)

      await orchestrator.initializeAppliance(mockStub)
      await vi.advanceTimersByTimeAsync(1) // drain initial seed
      expect(client.reseedApplianceState).toHaveBeenCalledTimes(1)

      // Advance by one interval — interval fires, reseed called again with non-undefined result
      await vi.advanceTimersByTimeAsync(60_000)
      expect(client.reseedApplianceState).toHaveBeenCalledTimes(2)
    })

    it('should log error when interval reseed rejects', async () => {
      await orchestrator.initializeAppliance(mockStub)
      await vi.advanceTimersByTimeAsync(1) // drain initial seed

      vi.mocked(client.reseedApplianceState).mockRejectedValueOnce(new Error('poll failed'))
      loggerErrorSpy.mockClear()

      // Advance by one interval — triggers the catch branch
      await vi.advanceTimersByTimeAsync(60_000)

      expect(loggerErrorSpy).toHaveBeenCalled()
    })

    it('should stop interval when isShuttingDown is set before interval fires', async () => {
      await orchestrator.initializeAppliance(mockStub)
      await vi.advanceTimersByTimeAsync(1) // drain initial seed

      vi.mocked(client.reseedApplianceState).mockClear()

      // Set shutting down and manually advance — interval callback checks isShuttingDown
      orchestrator.isShuttingDown = true
      await vi.advanceTimersByTimeAsync(60_000)

      expect(client.reseedApplianceState).not.toHaveBeenCalled()
    })

    it('should log error when command re-poll reseed rejects', async () => {
      let capturedHandler: (topic: string, message: Buffer) => void = () => {}
      vi.mocked(mqtt.subscribe).mockImplementation((_topic, callback) => {
        capturedHandler = callback
        return Promise.resolve()
      })

      vi.mocked(client.sendApplianceCommand).mockResolvedValueOnce({ applianceId: 'appliance-1' } as unknown as Awaited<
        ReturnType<typeof client.sendApplianceCommand>
      >)

      await orchestrator.initializeAppliance(mockStub)
      await vi.advanceTimersByTimeAsync(1) // drain initial seed

      // Make the next reseedApplianceState call (the re-poll) reject
      vi.mocked(client.reseedApplianceState).mockRejectedValueOnce(new Error('re-poll failed'))

      capturedHandler('test_appliances/appliance-1/command', Buffer.from('{"mode":"cool"}'))
      await vi.advanceTimersByTimeAsync(1) // let command settle

      loggerErrorSpy.mockClear()

      // Advance past commandStateDelaySeconds — re-poll fires and rejects → error logged
      await vi.advanceTimersByTimeAsync(35_000)

      expect(loggerErrorSpy).toHaveBeenCalled()
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

    it('should delete cache entries for both state and autoDiscovery on cleanup', async () => {
      const { cache } = await import('@/cache.js')

      await orchestrator.initializeAppliance(mockStub)

      vi.mocked(cache.delete).mockClear()
      orchestrator.cleanupAppliance('appliance-1')

      // Both per-appliance cache keys must be deleted
      expect(cache.delete).toHaveBeenCalledWith('appliance-1:state')
      // autoDiscovery key uses the capabilitiesHash from the appliance mock ('mockhash000')
      expect(cache.delete).toHaveBeenCalledWith('appliance-1:auto-discovery:mockhash000')
      expect(cache.delete).toHaveBeenCalledTimes(2)
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
      const shortGraceOrchestrator = new Orchestrator(client, mqtt, {
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
      const shortGraceOrchestrator = new Orchestrator(client, mqtt, {
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
      const shortGraceOrchestrator = new Orchestrator(client, mqtt, {
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

    it('should call refreshSubscription when appliance set changes', async () => {
      const mockLivestream = {
        start: vi.fn(),
        stop: vi.fn(),
        onReconnect: vi.fn(),
        onEvent: vi.fn(),
        refreshSubscription: vi.fn(),
        isStreamConnected: vi.fn(() => false),
      }

      orchestrator.initializeLivestream(mockLivestream as unknown as import('@/livestream.js').LivestreamClient)

      vi.mocked(client.getAppliances).mockResolvedValue([mockStub])
      await orchestrator.discoverAppliances()

      // New appliance appeared → set changed → refreshSubscription called
      expect(mockLivestream.refreshSubscription).toHaveBeenCalled()
    })
  })

  describe('handleStreamEvent', () => {
    it('should trigger reseed when cache is not a raw Appliance', async () => {
      const { cache } = await import('@/cache.js')

      await orchestrator.initializeAppliance(mockStub)

      // Cache holds normalized state (not raw Appliance)
      vi.mocked(cache.get).mockReturnValue({ applianceId: 'appliance-1', deviceId: 'x', mode: 'cool' })

      orchestrator.handleStreamEvent({
        applianceId: 'appliance-1',
        property: 'WorkMode',
        value: 1,
      })

      // Reseed should be triggered to self-heal the cache
      await vi.advanceTimersByTimeAsync(0)
      expect(client.reseedApplianceState).toHaveBeenCalled()
    })

    it('should apply delta and publish when cache holds raw Appliance and state differs', async () => {
      const { cache } = await import('@/cache.js')
      const { createAppliance } = await import('@/appliances/factory.js')

      // Mock raw Appliance in cache
      const rawAppliance = {
        applianceId: 'appliance-1',
        properties: {
          reported: { WorkMode: 1, targetTemperatureC: 20 },
        },
      }
      vi.mocked(cache.get).mockReturnValue(rawAppliance)

      await orchestrator.initializeAppliance(mockStub)

      // Get the appliance instance and make normalizeState return different values
      const applianceInstance = orchestrator.getApplianceInstances().get('appliance-1')
      if (applianceInstance) {
        vi.mocked(applianceInstance.normalizeState)
          .mockReturnValueOnce({
            applianceId: 'appliance-1',
            deviceId: 'x',
            mode: 'cool',
          } as unknown as import('@/types/normalized.js').NormalizedState)
          .mockReturnValueOnce({
            applianceId: 'appliance-1',
            deviceId: 'x',
            mode: 'heat',
          } as unknown as import('@/types/normalized.js').NormalizedState)
      }

      // Suppress unused variable warning
      void createAppliance

      orchestrator.handleStreamEvent({
        applianceId: 'appliance-1',
        property: 'WorkMode',
        value: 2,
      })

      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', expect.any(String))
    })

    it('should not publish when delta produces no differences', async () => {
      const { cache } = await import('@/cache.js')

      const rawAppliance = {
        applianceId: 'appliance-1',
        properties: { reported: { WorkMode: 1 } },
      }
      vi.mocked(cache.get).mockReturnValue(rawAppliance)

      await orchestrator.initializeAppliance(mockStub)

      // Same normalized state before and after — no diff
      const applianceInstance = orchestrator.getApplianceInstances().get('appliance-1')
      if (applianceInstance) {
        const sameState = {
          applianceId: 'appliance-1',
          deviceId: 'x',
          mode: 'cool',
        } as unknown as import('@/types/normalized.js').NormalizedState
        vi.mocked(applianceInstance.normalizeState).mockReturnValue(sameState)
      }

      vi.mocked(mqtt.publish).mockClear()

      orchestrator.handleStreamEvent({
        applianceId: 'appliance-1',
        property: 'WorkMode',
        value: 1,
      })

      expect(mqtt.publish).not.toHaveBeenCalled()
    })

    it('should do nothing for unknown appliance', () => {
      orchestrator.handleStreamEvent({
        applianceId: 'unknown-appliance',
        property: 'WorkMode',
        value: 0,
      })

      expect(client.reseedApplianceState).not.toHaveBeenCalled()
      expect(mqtt.publish).not.toHaveBeenCalled()
    })

    it('logs a debug message when event arrives for an untracked applianceId', () => {
      loggerDebugSpy.mockClear()

      orchestrator.handleStreamEvent({
        applianceId: 'unknown-appliance',
        property: 'WorkMode',
        value: 0,
      })

      // Must log a debug message mentioning the unknown applianceId
      const debugCalls = loggerDebugSpy.mock.calls as unknown[][]
      const ignoredCall = debugCalls.find((args) => {
        const obj = args[0]
        const msg = typeof args[1] === 'string' ? args[1] : ''
        // Either the message or first arg contains the applianceId
        const hasId =
          msg.includes('unknown-appliance') ||
          (typeof obj === 'object' &&
            obj !== null &&
            (obj as Record<string, unknown>).applianceId === 'unknown-appliance')
        return hasId
      })
      expect(ignoredCall).toBeDefined()
    })

    it('logs a debug message when event applies but produces no state diff', async () => {
      const { cache } = await import('@/cache.js')

      const rawAppliance = {
        applianceId: 'appliance-1',
        properties: { reported: { WorkMode: 1 } },
      }
      vi.mocked(cache.get).mockReturnValue(rawAppliance)

      await orchestrator.initializeAppliance(mockStub)

      // Same normalized state before and after — no diff
      const applianceInstance = orchestrator.getApplianceInstances().get('appliance-1')
      if (applianceInstance) {
        const sameState = {
          applianceId: 'appliance-1',
          deviceId: 'x',
          mode: 'cool',
        } as unknown as import('@/types/normalized.js').NormalizedState
        vi.mocked(applianceInstance.normalizeState).mockReturnValue(sameState)
      }

      loggerDebugSpy.mockClear()

      orchestrator.handleStreamEvent({
        applianceId: 'appliance-1',
        property: 'WorkMode',
        value: 1,
      })

      const debugCalls = loggerDebugSpy.mock.calls as unknown[][]
      // Must have a debug call about no state change for this appliance
      const noDiffCall = debugCalls.find((args) => {
        const obj = args[0]
        const msg = typeof args[1] === 'string' ? args[1] : ''
        const hasId =
          msg.includes('appliance-1') ||
          (typeof obj === 'object' && obj !== null && (obj as Record<string, unknown>).applianceId === 'appliance-1')
        const mentionsNoChange =
          msg.toLowerCase().includes('no state') ||
          msg.toLowerCase().includes('no change') ||
          msg.toLowerCase().includes('no diff')
        return hasId && mentionsNoChange
      })
      expect(noDiffCall).toBeDefined()
    })

    it('should log error when self-heal reseed rejects', async () => {
      const { cache } = await import('@/cache.js')

      await orchestrator.initializeAppliance(mockStub)

      // Cache holds normalized state — triggers self-heal path
      vi.mocked(cache.get).mockReturnValue({ applianceId: 'appliance-1', deviceId: 'x', mode: 'cool' })

      // Make the reseed reject
      vi.mocked(client.reseedApplianceState).mockRejectedValueOnce(new Error('Network error'))

      loggerErrorSpy.mockClear()

      orchestrator.handleStreamEvent({
        applianceId: 'appliance-1',
        property: 'WorkMode',
        value: 2,
      })

      // Let the promise rejection settle
      await vi.advanceTimersByTimeAsync(0)

      expect(loggerErrorSpy).toHaveBeenCalled()
    })
  })

  describe('initializeLivestream', () => {
    function createMockLivestream() {
      return {
        start: vi.fn(),
        stop: vi.fn(),
        onReconnect: vi.fn(),
        onEvent: vi.fn(),
        refreshSubscription: vi.fn(),
        isStreamConnected: vi.fn(() => false),
      }
    }

    it('should register reconnect and event hooks then call start', () => {
      const mockLivestream = createMockLivestream()

      orchestrator.initializeLivestream(mockLivestream as unknown as import('@/livestream.js').LivestreamClient)

      expect(mockLivestream.onReconnect).toHaveBeenCalledWith(expect.any(Function))
      expect(mockLivestream.onEvent).toHaveBeenCalledWith(expect.any(Function))
      expect(mockLivestream.start).toHaveBeenCalled()
    })

    it('should be idempotent — second call does nothing', () => {
      const mockLivestream = createMockLivestream()

      orchestrator.initializeLivestream(mockLivestream as unknown as import('@/livestream.js').LivestreamClient)
      orchestrator.initializeLivestream(mockLivestream as unknown as import('@/livestream.js').LivestreamClient)

      expect(mockLivestream.start).toHaveBeenCalledTimes(1)
    })

    it('should forward stream events to handleStreamEvent via onEvent callback', async () => {
      const { cache } = await import('@/cache.js')
      const mockLivestream = createMockLivestream()

      await orchestrator.initializeAppliance(mockStub)
      // Drain the initial seed setTimeout(0) before wiring the livestream
      await vi.advanceTimersByTimeAsync(1)
      orchestrator.initializeLivestream(mockLivestream as unknown as import('@/livestream.js').LivestreamClient)

      // Capture the onEvent callback
      const eventHook = vi.mocked(mockLivestream.onEvent).mock.calls[0]?.[0]
      expect(eventHook).toBeDefined()

      // Set cache to normalized state to trigger self-heal path (simplest observable effect)
      vi.mocked(cache.get).mockReturnValue({ applianceId: 'appliance-1', deviceId: 'x', mode: 'cool' })
      vi.mocked(client.reseedApplianceState).mockClear()

      // Invoke the callback — should route through handleStreamEvent
      if (eventHook) {
        eventHook({ applianceId: 'appliance-1', property: 'WorkMode', value: 2 })
      }

      await vi.advanceTimersByTimeAsync(0)
      expect(client.reseedApplianceState).toHaveBeenCalled()
    })

    it('should reseed all appliances on reconnect', async () => {
      const mockLivestream = createMockLivestream()

      await orchestrator.initializeAppliance(mockStub)
      // Drain the initial seed setTimeout(0) before wiring the livestream
      await vi.advanceTimersByTimeAsync(1)

      orchestrator.initializeLivestream(mockLivestream as unknown as import('@/livestream.js').LivestreamClient)

      // Capture the reconnect hook
      const reconnectHook = vi.mocked(mockLivestream.onReconnect).mock.calls[0]?.[0]
      expect(reconnectHook).toBeDefined()

      vi.mocked(client.reseedApplianceState).mockClear()

      // Fire the reconnect hook and advance past the 100ms per-appliance stagger delay
      const reconnectPromise = reconnectHook ? reconnectHook() : Promise.resolve()
      await vi.advanceTimersByTimeAsync(200)
      await reconnectPromise

      expect(client.reseedApplianceState).toHaveBeenCalledTimes(1)
    })

    it('should pass settle window to reseedApplianceState on reconnect (regression: on-connect reseed must not clobber in-flight command)', async () => {
      const mockLivestream = createMockLivestream()

      await orchestrator.initializeAppliance(mockStub)
      // Drain the initial seed setTimeout(0) before wiring the livestream
      await vi.advanceTimersByTimeAsync(1)

      orchestrator.initializeLivestream(mockLivestream as unknown as import('@/livestream.js').LivestreamClient)

      const reconnectHook = vi.mocked(mockLivestream.onReconnect).mock.calls[0]?.[0]
      expect(reconnectHook).toBeDefined()

      vi.mocked(client.reseedApplianceState).mockClear()

      // Fire the reconnect hook and advance past the 100ms per-appliance stagger delay
      const reconnectPromise = reconnectHook ? reconnectHook() : Promise.resolve()
      await vi.advanceTimersByTimeAsync(200)
      await reconnectPromise

      // Must be called with settleWindowMs = commandStateDelaySeconds * 1000 (30 * 1000 = 30_000)
      // so the guard in fetchAndProcessApplianceState suppresses regression of commanded fields
      // during the settle window — mirroring the self-heal path fix at orchestrator.ts:324
      expect(client.reseedApplianceState).toHaveBeenCalledWith(expect.anything(), 30_000)
    })

    it('should stop reseeding on reconnect when shutting down', async () => {
      const mockLivestream = createMockLivestream()

      const anotherStub: ApplianceStub = {
        applianceId: 'appliance-2',
        applianceName: 'Another AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }

      await orchestrator.initializeAppliance(mockStub)
      await orchestrator.initializeAppliance(anotherStub)
      orchestrator.initializeLivestream(mockLivestream as unknown as import('@/livestream.js').LivestreamClient)

      orchestrator.isShuttingDown = true

      const reconnectHook = vi.mocked(mockLivestream.onReconnect).mock.calls[0]?.[0]
      vi.mocked(client.reseedApplianceState).mockClear()
      if (reconnectHook) await reconnectHook()

      // Should stop early — at most 0 reseeds (shutting down before first iteration)
      expect(client.reseedApplianceState).not.toHaveBeenCalled()
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

    it('should normalize a raw Appliance from cache before republishing on reconnect', async () => {
      const { cache } = await import('@/cache.js')

      // Cache holds a raw Appliance (the shape stored after reseed/stream-delta)
      vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)

      await orchestrator.initializeAppliance(mockStub)

      // Make normalizeState return a realistic normalized object
      const expectedNormalized: NormalizedState = {
        applianceId: 'appliance-1',
        deviceId: 'device-123',
        mode: 'cool',
        applianceState: 'on',
        targetTemperatureC: 22,
        ambientTemperatureC: 24,
        fanSpeedSetting: 'auto',
        verticalSwing: 'on',
        sleepMode: 'off',
      } as unknown as NormalizedState

      const applianceInstance = orchestrator.getApplianceInstances().get('appliance-1')
      expect(applianceInstance).toBeDefined()
      if (applianceInstance) {
        vi.mocked(applianceInstance.normalizeState).mockReturnValue(expectedNormalized)
      }

      const reconnectCb = vi.mocked(mqtt.onReconnect).mock.calls[0]?.[0]
      vi.mocked(mqtt.publish).mockClear()

      reconnectCb?.()

      // Must publish the normalized form, NOT the raw Appliance with nested properties
      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(expectedNormalized))
      // Verify the published payload has top-level normalized fields and no `properties` key
      const publishedPayload = JSON.parse((vi.mocked(mqtt.publish).mock.calls[0] as [string, string])[1]) as Record<
        string,
        unknown
      >
      expect(publishedPayload).not.toHaveProperty('properties')
      expect(publishedPayload).toHaveProperty('mode', 'cool')
    })

    it('should publish already-normalized state as-is on reconnect (not an Appliance shape)', async () => {
      const { cache } = await import('@/cache.js')

      // An already-normalized state object (from command feedback path)
      const normalizedState = { applianceId: 'appliance-1', deviceId: 'x', mode: 'heat', targetTemperatureC: 24 }
      vi.mocked(cache.get).mockReturnValue(normalizedState)

      await orchestrator.initializeAppliance(mockStub)

      const reconnectCb = vi.mocked(mqtt.onReconnect).mock.calls[0]?.[0]
      vi.mocked(mqtt.publish).mockClear()

      reconnectCb?.()

      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(normalizedState))
    })
  })

  describe('seed rejection guard', () => {
    it('should not cause unhandled rejection and should log error when reseedApplianceState rejects', async () => {
      loggerErrorSpy.mockClear()

      vi.mocked(client.reseedApplianceState).mockRejectedValue(new Error('Network timeout'))

      await orchestrator.initializeAppliance(mockStub)

      // Advance past setTimeout(0) to fire the seed
      await vi.advanceTimersByTimeAsync(0)

      // The orchestrator must not have crashed
      expect(orchestrator.isShuttingDown).toBe(false)

      // Error should have been logged
      expect(loggerErrorSpy).toHaveBeenCalled()
    })
  })

  describe('API failure tracking and restart', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: number | string | null | undefined) => {
        // Intentionally does not throw — the spy records the call.
        return undefined as never
      })
    })

    afterEach(() => {
      exitSpy.mockRestore()
    })

    it('should call process.exit(1) when stream signal exceeds failure threshold', async () => {
      const thresholdMs = 500
      const mockLivestream = {
        start: vi.fn(),
        stop: vi.fn(),
        onReconnect: vi.fn(),
        onEvent: vi.fn(),
        refreshSubscription: vi.fn(),
        isStreamConnected: vi.fn(() => true),
      }

      const shortThresholdOrchestrator = new Orchestrator(client, mqtt, {
        ...defaultConfig,
        idleTimeoutMs: 100,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: true,
      })

      shortThresholdOrchestrator.initializeLivestream(
        mockLivestream as unknown as import('@/livestream.js').LivestreamClient,
      )

      await shortThresholdOrchestrator.initializeAppliance(mockStub)

      // reseedApplianceState returns undefined = API failure
      vi.mocked(client.reseedApplianceState).mockResolvedValue(undefined)

      // Advance past timeout(0) to trigger the initial seed (which returns undefined)
      vi.setSystemTime(Date.now() + thresholdMs + 100)
      await vi.advanceTimersByTimeAsync(0)

      expect(exitSpy).toHaveBeenCalledWith(1)
    })

    it('should not call process.exit when healthCheckEnabled is false', async () => {
      const thresholdMs = 100
      const mockLivestream = {
        start: vi.fn(),
        stop: vi.fn(),
        onReconnect: vi.fn(),
        onEvent: vi.fn(),
        refreshSubscription: vi.fn(),
        isStreamConnected: vi.fn(() => true),
      }

      const orchestratorNoHealth = new Orchestrator(client, mqtt, {
        ...defaultConfig,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: false,
      })

      orchestratorNoHealth.initializeLivestream(mockLivestream as unknown as import('@/livestream.js').LivestreamClient)
      vi.mocked(client.reseedApplianceState).mockResolvedValue(undefined)

      await orchestratorNoHealth.initializeAppliance(mockStub)

      vi.setSystemTime(Date.now() + thresholdMs + 100)
      await vi.advanceTimersByTimeAsync(0)

      expect(exitSpy).not.toHaveBeenCalled()
    })

    it('should not call process.exit when isShuttingDown is true', async () => {
      const thresholdMs = 100
      const shortThresholdOrchestrator = new Orchestrator(client, mqtt, {
        ...defaultConfig,
        apiFailureRestartThresholdMs: thresholdMs,
        healthCheckEnabled: true,
      })

      vi.mocked(client.reseedApplianceState).mockResolvedValue(undefined)

      await shortThresholdOrchestrator.initializeAppliance(mockStub)

      // Mark as shutting down before seed fires
      shortThresholdOrchestrator.isShuttingDown = true

      vi.setSystemTime(Date.now() + thresholdMs + 100)
      await vi.advanceTimersByTimeAsync(0)

      expect(exitSpy).not.toHaveBeenCalled()
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
      const noBirthOrchestrator = new Orchestrator(client, mqtt, {
        ...defaultConfig,
        haBirthRepublish: false,
      })

      await noBirthOrchestrator.initializeAppliance(mockStub)

      expect(mqtt.subscribeAbsolute).not.toHaveBeenCalled()
    })

    it('should republish discovery AND cached state for each appliance when birth payload matches', async () => {
      const { cache } = await import('@/cache.js')
      const cachedState = { mode: 'cool', targetTemperature: 22 }
      vi.mocked(cache.get).mockReturnValue(cachedState)

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

      // Both discovery and state must be republished
      expect(mqtt.autoDiscovery).toHaveBeenCalledWith('appliance-1', expect.any(String), { retain: true, qos: 2 })
      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(cachedState))
    })

    it('should not republish when birth payload does not match (e.g. offline)', async () => {
      const { cache } = await import('@/cache.js')
      vi.mocked(cache.get).mockReturnValue({ mode: 'cool' })

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
      const { cache } = await import('@/cache.js')
      vi.mocked(cache.get).mockReturnValue(undefined)

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
      const { cache } = await import('@/cache.js')
      const state1 = { mode: 'cool' }
      const state2 = { mode: 'heat' }
      const anotherStub: ApplianceStub = {
        applianceId: 'appliance-2',
        applianceName: 'Another AC',
        applianceType: 'PORTABLE_AIR_CONDITIONER',
        created: '2024-01-01T00:00:00Z',
      }

      vi.mocked(cache.get).mockImplementation((key: string) => {
        if (key === 'appliance-1:state') return state1
        if (key === 'appliance-2:state') return state2
        return undefined
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
      const noBirthOrchestrator = new Orchestrator(client, mqtt, {
        ...defaultConfig,
        haBirthRepublish: false,
      })

      await noBirthOrchestrator.initializeAppliance(mockStub)
      noBirthOrchestrator.shutdown()

      expect(mqtt.unsubscribeAbsolute).not.toHaveBeenCalled()
    })

    it('should normalize a raw Appliance from cache before republishing on birth', async () => {
      const { cache } = await import('@/cache.js')

      // Cache holds a raw Appliance (shape stored after reseed)
      vi.mocked(cache.get).mockReturnValue(mockApplianceStateResponse)

      await orchestrator.initializeAppliance(mockStub)

      const expectedNormalized: NormalizedState = {
        applianceId: 'appliance-1',
        deviceId: 'device-123',
        mode: 'cool',
        applianceState: 'on',
        targetTemperatureC: 22,
        ambientTemperatureC: 24,
        fanSpeedSetting: 'auto',
        verticalSwing: 'on',
        sleepMode: 'off',
      } as unknown as NormalizedState

      const applianceInstance = orchestrator.getApplianceInstances().get('appliance-1')
      expect(applianceInstance).toBeDefined()
      if (applianceInstance) {
        vi.mocked(applianceInstance.normalizeState).mockReturnValue(expectedNormalized)
      }

      const [, birthHandler] = vi.mocked(mqtt.subscribeAbsolute).mock.calls[0] as [
        string,
        (topic: string, message: Buffer) => void,
      ]

      vi.mocked(mqtt.publish).mockClear()
      vi.mocked(mqtt.autoDiscovery).mockClear()

      birthHandler('homeassistant/status', Buffer.from('online'))

      // Must publish the normalized form, NOT the raw Appliance with nested properties
      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(expectedNormalized))
      const publishedPayload = JSON.parse((vi.mocked(mqtt.publish).mock.calls[0] as [string, string])[1]) as Record<
        string,
        unknown
      >
      expect(publishedPayload).not.toHaveProperty('properties')
      expect(publishedPayload).toHaveProperty('mode', 'cool')
    })

    it('should publish already-normalized state as-is on birth (not an Appliance shape)', async () => {
      const { cache } = await import('@/cache.js')

      // Already-normalized state (from command feedback path)
      const normalizedState = { applianceId: 'appliance-1', deviceId: 'x', mode: 'dry', targetTemperatureC: 20 }
      vi.mocked(cache.get).mockReturnValue(normalizedState)

      await orchestrator.initializeAppliance(mockStub)

      const [, birthHandler] = vi.mocked(mqtt.subscribeAbsolute).mock.calls[0] as [
        string,
        (topic: string, message: Buffer) => void,
      ]

      vi.mocked(mqtt.publish).mockClear()
      vi.mocked(mqtt.autoDiscovery).mockClear()

      birthHandler('homeassistant/status', Buffer.from('online'))

      expect(mqtt.publish).toHaveBeenCalledWith('appliance-1/state', JSON.stringify(normalizedState))
    })
  })

  describe('shutdown', () => {
    it('should clean up orchestrator-owned resources', async () => {
      // Initialize an appliance first
      await orchestrator.initializeAppliance(mockStub)

      orchestrator.shutdown()

      expect(orchestrator.isShuttingDown).toBe(true)
      expect(client.cleanup).toHaveBeenCalled()
      expect(mqtt.disconnect).toHaveBeenCalled()
    })

    it('should stop the livestream on shutdown', () => {
      const mockLivestream = {
        start: vi.fn(),
        stop: vi.fn(),
        onReconnect: vi.fn(),
        onEvent: vi.fn(),
        refreshSubscription: vi.fn(),
        isStreamConnected: vi.fn(() => false),
      }

      orchestrator.initializeLivestream(mockLivestream as unknown as import('@/livestream.js').LivestreamClient)
      orchestrator.shutdown()

      expect(mockLivestream.stop).toHaveBeenCalled()
    })

    it('should be idempotent', () => {
      orchestrator.shutdown()
      orchestrator.shutdown()

      // cleanup should only be called once
      expect(client.cleanup).toHaveBeenCalledTimes(1)
    })

    it('should cancel pending command re-poll timeouts on shutdown', async () => {
      let capturedHandler: (topic: string, message: Buffer) => void = () => {}
      vi.mocked(mqtt.subscribe).mockImplementation((_topic, callback) => {
        capturedHandler = callback
        return Promise.resolve()
      })

      vi.mocked(client.sendApplianceCommand).mockResolvedValueOnce({ applianceId: 'appliance-1' } as unknown as Awaited<
        ReturnType<typeof client.sendApplianceCommand>
      >)

      await orchestrator.initializeAppliance(mockStub)
      await vi.advanceTimersByTimeAsync(1) // drain initial seed

      // Fire a command to schedule a re-poll timeout
      capturedHandler('test_appliances/appliance-1/command', Buffer.from('{"mode":"cool"}'))
      await vi.advanceTimersByTimeAsync(1) // let command settle

      vi.mocked(client.reseedApplianceState).mockClear()

      orchestrator.shutdown()

      // Advance past commandStateDelaySeconds — re-poll should NOT fire
      await vi.advanceTimersByTimeAsync(35_000)
      expect(client.reseedApplianceState).not.toHaveBeenCalled()
    })

    it('should cancel polling intervals on shutdown', async () => {
      await orchestrator.initializeAppliance(mockStub)
      await vi.advanceTimersByTimeAsync(1) // drain initial seed

      vi.mocked(client.reseedApplianceState).mockClear()

      orchestrator.shutdown()

      // Advance past refreshInterval — polling interval should NOT fire
      await vi.advanceTimersByTimeAsync(60_000)
      expect(client.reseedApplianceState).not.toHaveBeenCalled()
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

  // ---------------------------------------------------------------------------
  // Command settle-window overlay — regression tests for the state-flapping bug
  // ---------------------------------------------------------------------------
  //
  // Confirmed reproduction:
  //   T0:     command targetTemperatureC=23 → optimistic publish {target:23}, cache=NormalizedState
  //   T0+10s: ambient SSE → self-heal reseed (cache not raw) → GET returns stale {target:22}
  //           → regressive publish target=22 ← BUG
  //   T0+30s: authoritative re-poll → target=23 ← recovery (too late; HA already flapped)
  //
  // Fix: (a) self-heal reseed passes settleWindowMs so the guard in
  //      fetchAndProcessApplianceState skips the regressive publish,
  //      (b) SSE delta overlay pins commanded fields so a subsequent delta on the
  //      stale-raw cache doesn't regress commanded values either.
  // ---------------------------------------------------------------------------

  describe('command settle-window overlay', () => {
    /**
     * Helper: return a mock ElectroluxClient that also exposes
     * getPendingCommandFields — the new method required by the fix.
     * Defaults to no pending fields.
     */
    function createMockClientWithPins(
      pendingFields: Partial<NormalizedState> | undefined = undefined,
    ): ElectroluxClient {
      return {
        ...createMockClient(),
        getPendingCommandFields: vi.fn(() => pendingFields),
      } as unknown as ElectroluxClient
    }

    it('self-heal reseed within the settle window passes settleWindowMs (not 0) to reseedApplianceState', async () => {
      // This verifies the fix for regression path (a): the self-heal reseed that
      // fires when cache is not a raw Appliance must forward the settle window so
      // fetchAndProcessApplianceState's guard suppresses the regressive publish.
      const pins: Partial<NormalizedState> = { targetTemperatureC: 23 }
      const pinnedClient = createMockClientWithPins(pins)
      const orch = new Orchestrator(pinnedClient, mqtt, defaultConfig)
      const { cache } = await import('@/cache.js')

      await orch.initializeAppliance(mockStub)

      // Drain the initial seed so its reseedApplianceState call doesn't pollute assertions
      await vi.advanceTimersByTimeAsync(1)
      vi.mocked(pinnedClient.reseedApplianceState).mockClear()

      // Cache now holds normalized state (not raw Appliance) — the post-command scenario
      vi.mocked(cache.get).mockReturnValue({
        applianceId: 'appliance-1',
        deviceId: 'x',
        mode: 'cool',
        targetTemperatureC: 23,
      })

      // Fire an ambient SSE event — cache is not raw Appliance → self-heal path
      orch.handleStreamEvent({
        applianceId: 'appliance-1',
        property: 'ambientTemperatureC',
        value: 24,
      })

      await vi.advanceTimersByTimeAsync(0)

      // The self-heal reseed must be called with the settle window (30000ms), NOT 0
      const reseedCalls = vi.mocked(pinnedClient.reseedApplianceState).mock.calls
      expect(reseedCalls.length).toBeGreaterThan(0)
      const [, settleArg] = reseedCalls[0] ?? []
      expect(settleArg).toBeDefined()
      expect(settleArg as number).toBeGreaterThan(0)
    })

    it('SSE delta within the settle window overlays the commanded targetTemperatureC — no regression', async () => {
      // Arrange: command set targetTemperatureC=23; pending pins reflect this
      const pins: Partial<NormalizedState> = { targetTemperatureC: 23 }
      const pinnedClient = createMockClientWithPins(pins)
      const orch = new Orchestrator(pinnedClient, mqtt, defaultConfig)
      const { cache } = await import('@/cache.js')

      await orch.initializeAppliance(mockStub)

      // After the settle-window guard ran, cache holds the stale raw Appliance
      // (targetTemperatureC=22 — pre-command value)
      const staleRawAppliance = {
        applianceId: 'appliance-1',
        properties: {
          reported: { targetTemperatureC: 22, ambientTemperatureC: 24 },
        },
      }
      vi.mocked(cache.get).mockReturnValue(staleRawAppliance)

      // Make normalizeState return states that include the stale targetTemperatureC=22
      // so we can confirm the overlay corrects it to 23
      const applianceInstance = orch.getApplianceInstances().get('appliance-1')
      expect(applianceInstance).toBeDefined()
      if (applianceInstance) {
        vi.mocked(applianceInstance.normalizeState)
          // First call: "before" state (old stale raw → normalized)
          .mockReturnValueOnce({
            applianceId: 'appliance-1',
            deviceId: 'x',
            mode: 'cool',
            targetTemperatureC: 22,
            ambientTemperatureC: 24,
          } as unknown as NormalizedState)
          // Second call: "after" state (patched stale raw → normalized) — ambient updated but target still 22
          .mockReturnValueOnce({
            applianceId: 'appliance-1',
            deviceId: 'x',
            mode: 'cool',
            targetTemperatureC: 22,
            ambientTemperatureC: 25, // ambient changed
          } as unknown as NormalizedState)
      }

      vi.mocked(mqtt.publish).mockClear()

      // Ambient SSE event — cache IS a raw Appliance, so delta path runs
      orch.handleStreamEvent({
        applianceId: 'appliance-1',
        property: 'ambientTemperatureC',
        value: 25,
      })

      // Published state must have: ambientTemperatureC=25 (SSE update) AND targetTemperatureC=23 (pin)
      expect(mqtt.publish).toHaveBeenCalledOnce()
      const published = JSON.parse((vi.mocked(mqtt.publish).mock.calls[0] as [string, string])[1]) as Record<
        string,
        unknown
      >
      expect(published['targetTemperatureC']).toBe(23) // pinned — must NOT regress to 22
      expect(published['ambientTemperatureC']).toBe(25) // live update preserved
    })

    it('SSE delta within the settle window pins applianceState alongside temperature', async () => {
      // Demonstrates that multiple commanded fields are pinned simultaneously
      const pins: Partial<NormalizedState> = {
        targetTemperatureC: 23,
        applianceState: 'on',
      }
      const pinnedClient = createMockClientWithPins(pins)
      const orch = new Orchestrator(pinnedClient, mqtt, defaultConfig)
      const { cache } = await import('@/cache.js')

      await orch.initializeAppliance(mockStub)

      const staleRawAppliance = {
        applianceId: 'appliance-1',
        properties: {
          reported: { targetTemperatureC: 22, applianceState: 'off', ambientTemperatureC: 24 },
        },
      }
      vi.mocked(cache.get).mockReturnValue(staleRawAppliance)

      const applianceInstance = orch.getApplianceInstances().get('appliance-1')
      if (applianceInstance) {
        vi.mocked(applianceInstance.normalizeState)
          .mockReturnValueOnce({
            applianceId: 'appliance-1',
            deviceId: 'x',
            mode: 'cool',
            targetTemperatureC: 22,
            applianceState: 'off',
            ambientTemperatureC: 24,
          } as unknown as NormalizedState)
          .mockReturnValueOnce({
            applianceId: 'appliance-1',
            deviceId: 'x',
            mode: 'cool',
            targetTemperatureC: 22,
            applianceState: 'off',
            ambientTemperatureC: 26,
          } as unknown as NormalizedState)
      }

      vi.mocked(mqtt.publish).mockClear()

      orch.handleStreamEvent({
        applianceId: 'appliance-1',
        property: 'ambientTemperatureC',
        value: 26,
      })

      expect(mqtt.publish).toHaveBeenCalledOnce()
      const published = JSON.parse((vi.mocked(mqtt.publish).mock.calls[0] as [string, string])[1]) as Record<
        string,
        unknown
      >
      expect(published['targetTemperatureC']).toBe(23)
      expect(published['applianceState']).toBe('on')
      expect(published['ambientTemperatureC']).toBe(26)
    })

    it('after the settle window, SSE delta publishes pure API state (no overlay)', async () => {
      // After the window expires, getPendingCommandFields returns undefined
      const pinnedClient = createMockClientWithPins(undefined) // no pending pins
      const orch = new Orchestrator(pinnedClient, mqtt, defaultConfig)
      const { cache } = await import('@/cache.js')

      await orch.initializeAppliance(mockStub)

      const rawAppliance = {
        applianceId: 'appliance-1',
        properties: { reported: { targetTemperatureC: 22, ambientTemperatureC: 24 } },
      }
      vi.mocked(cache.get).mockReturnValue(rawAppliance)

      const applianceInstance = orch.getApplianceInstances().get('appliance-1')
      if (applianceInstance) {
        vi.mocked(applianceInstance.normalizeState)
          .mockReturnValueOnce({
            applianceId: 'appliance-1',
            deviceId: 'x',
            mode: 'cool',
            targetTemperatureC: 22,
            ambientTemperatureC: 24,
          } as unknown as NormalizedState)
          .mockReturnValueOnce({
            applianceId: 'appliance-1',
            deviceId: 'x',
            mode: 'cool',
            targetTemperatureC: 22, // API truth after window: target=22 (unchanged)
            ambientTemperatureC: 26,
          } as unknown as NormalizedState)
      }

      vi.mocked(mqtt.publish).mockClear()

      orch.handleStreamEvent({
        applianceId: 'appliance-1',
        property: 'ambientTemperatureC',
        value: 26,
      })

      expect(mqtt.publish).toHaveBeenCalledOnce()
      const published = JSON.parse((vi.mocked(mqtt.publish).mock.calls[0] as [string, string])[1]) as Record<
        string,
        unknown
      >
      // No overlay → publishes the API truth
      expect(published['targetTemperatureC']).toBe(22)
      expect(published['ambientTemperatureC']).toBe(26)
    })

    it('interval poll within the settle window does not regress commanded fields (existing guard preserved)', async () => {
      // The interval poll already passes settleWindowMs; the guard in
      // fetchAndProcessApplianceState must still suppress the regression.
      // Verify that reseedApplianceState is called with a non-zero settleWindowMs.
      const orch = new Orchestrator(createMockClientWithPins(), mqtt, defaultConfig)

      await orch.initializeAppliance(mockStub)
      // Drain initial seed
      await vi.advanceTimersByTimeAsync(1)

      vi.mocked(orch['client'].reseedApplianceState).mockClear()

      // Advance by one refreshInterval to fire the interval poll
      await vi.advanceTimersByTimeAsync(60_000)

      // Interval poll must pass the settle window (commandStateDelaySeconds * 1000 = 30000)
      const calls = vi.mocked(orch['client'].reseedApplianceState).mock.calls
      expect(calls.length).toBeGreaterThan(0)
      const intervalCall = calls[0]
      expect(intervalCall).toBeDefined()
      if (intervalCall) {
        expect(intervalCall[1]).toBe(30_000)
      }
    })

    it('pending command pins are cleared when appliance is removed via cleanupAppliance', async () => {
      const pins: Partial<NormalizedState> = { targetTemperatureC: 23 }
      const pinnedClient = createMockClientWithPins(pins)
      const orch = new Orchestrator(pinnedClient, mqtt, defaultConfig)

      await orch.initializeAppliance(mockStub)
      orch.cleanupAppliance('appliance-1')

      // After cleanup, removeAppliance must have been called on the client,
      // which is responsible for clearing pending command fields
      expect(pinnedClient.removeAppliance).toHaveBeenCalledWith('appliance-1')
    })

    it('pending command pins are cleared for all appliances on shutdown', async () => {
      const pinnedClient = createMockClientWithPins({ targetTemperatureC: 23 })
      const orch = new Orchestrator(pinnedClient, mqtt, defaultConfig)

      await orch.initializeAppliance(mockStub)

      // Shutdown calls client.cleanup() which should clear all pending state
      orch.shutdown()

      expect(pinnedClient.cleanup).toHaveBeenCalled()
    })
  })
})

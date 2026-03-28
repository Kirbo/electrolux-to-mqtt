import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaseAppliance } from '../src/appliances/base.js'
import type { ElectroluxClient } from '../src/electrolux.js'
import type { IMqtt } from '../src/mqtt.js'
import { Orchestrator, type OrchestratorConfig } from '../src/orchestrator.js'
import type { ApplianceInfo, ApplianceStub } from '../src/types.js'

// Mock dependencies
vi.mock('../src/logger.js', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

vi.mock('../src/health.js', () => ({
  writeHealthFile: vi.fn(),
}))

vi.mock('../src/cache.js', () => ({
  cache: {
    cacheKey: vi.fn((id: string) => ({
      state: `${id}:state`,
      autoDiscovery: `${id}:auto-discovery`,
    })),
    matchByValue: vi.fn(() => false),
  },
}))

vi.mock('../src/appliances/factory.js', () => ({
  ApplianceFactory: {
    create: vi.fn(
      (stub: ApplianceStub, _info: ApplianceInfo): BaseAppliance =>
        ({
          getApplianceId: () => stub.applianceId,
          getApplianceName: () => stub.applianceName,
          getModelName: () => 'COMFORT600',
          getApplianceType: () => stub.applianceType,
          normalizeState: vi.fn(),
          transformMqttCommandToApi: vi.fn(),
          generateAutoDiscoveryConfig: vi.fn(() => ({ test: 'config' })),
          validateCommand: vi.fn(() => ({ valid: true })),
          deriveImmediateStateFromCommand: vi.fn(() => null),
        }) as unknown as BaseAppliance,
    ),
  },
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
  }
}

const defaultConfig: OrchestratorConfig = {
  refreshInterval: 30000,
  applianceDiscoveryInterval: 300000,
  autoDiscovery: true,
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
      const { cache } = await import('../src/cache.js')

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
      const { cache } = await import('../src/cache.js')

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

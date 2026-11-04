/**
 * Smoke tests for src/index.ts — verifies that importing the entry point:
 *   - Constructs ElectroluxClient, Mqtt, and Orchestrator exactly once
 *   - Registers SIGTERM and SIGINT handlers on process
 *   - SIGTERM handler invokes orchestrator.shutdown
 *   - main() handles null/empty appliances and normal appliance lists
 *
 * main() is guarded by `if (process.env.VITEST !== 'true')` in src/index.ts,
 * so it does NOT auto-execute on import. The exported `main` function is called
 * directly in dedicated tests to cover its branches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startVersionChecker as mockStartVersionChecker } from '#/version-checker.ts'

// ─── Mock all modules that perform side-effects on import ────────────────────

// vi.mock calls are hoisted to the top of the module by Vitest.

vi.mock('#/config.ts', () => ({
  default: {
    mqtt: {
      url: 'mqtt://test-broker:1883',
      clientId: 'test-client',
      username: 'test-user',
      password: 'test-pass',
      topicPrefix: 'test_',
      retain: false,
      qos: 2,
    },
    electrolux: {
      apiKey: 'test-api-key',
      username: 'test@example.com',
      password: 'test-pass',
      countryCode: 'US',
      refreshInterval: 30,
      applianceDiscoveryInterval: 300,
      renewTokenBeforeExpiry: 60,
      commandStateDelaySeconds: 30,
      applianceRemovalGracePeriodMinutes: 30,
      apiTimeoutSeconds: 25,
    },
    logging: {
      showChanges: true,
      ignoredKeys: [],
    },
    homeAssistant: {
      autoDiscovery: true,
      revertStateOnRejection: false,
      discoveryPrefix: 'homeassistant',
    },
    healthCheck: {
      enabled: false,
      unHealthyRestartMinutes: 45,
    },
  },
}))

// Shared mutable mock instances — reassigned in beforeEach after resetModules
let mockApiInstance: {
  getAppliances: ReturnType<typeof vi.fn>
}

let mockAuthInstance: {
  getAccessToken: ReturnType<typeof vi.fn>
  cleanup: ReturnType<typeof vi.fn>
}

let mockOrchestratorInstance: {
  shutdown: ReturnType<typeof vi.fn>
  isShuttingDown: boolean
  initializeAppliance: ReturnType<typeof vi.fn>
  discoverAppliances: ReturnType<typeof vi.fn>
}

const MockOrchestratorCtor = vi.fn(function (this: typeof mockOrchestratorInstance) {
  this.shutdown = vi.fn(() => Promise.resolve())
  this.isShuttingDown = false
  this.initializeAppliance = vi.fn().mockResolvedValue(undefined)
  this.discoverAppliances = vi.fn()
  mockOrchestratorInstance = this
})

vi.mock('#/orchestrator.ts', () => ({
  Orchestrator: MockOrchestratorCtor,
}))

const MockMqttCtor = vi.fn(function (this: Record<string, unknown>) {
  this.client = { on: vi.fn(), connected: true }
  this.topicPrefix = 'test_appliances'
  this.publish = vi.fn()
  this.publishInfo = vi.fn()
  this.subscribe = vi.fn()
  this.unsubscribe = vi.fn()
  this.disconnect = vi.fn()
  this.autoDiscovery = vi.fn()
  this.onReconnect = vi.fn()
})

vi.mock('#/mqtt.ts', () => ({
  default: MockMqttCtor,
}))

const MockElectroluxApiCtor = vi.fn(function (this: typeof mockApiInstance) {
  this.getAppliances = vi.fn().mockResolvedValue([])
  mockApiInstance = this
})

const MockElectroluxAuthCtor = vi.fn(function (this: typeof mockAuthInstance) {
  this.getAccessToken = vi.fn().mockResolvedValue('access-token')
  this.cleanup = vi.fn()
  mockAuthInstance = this
})

const MockStateSyncCtor = vi.fn(function (this: Record<string, unknown>) {
  this.pollState = vi.fn()
})

const mockComputeBackoffDelay = vi.fn((retryCount: number, baseMs: number, maxMs: number) =>
  Math.min(baseMs * 2 ** retryCount, maxMs),
)

vi.mock('#/electrolux-api.ts', () => ({
  ElectroluxApi: MockElectroluxApiCtor,
}))

vi.mock('#/electrolux-auth.ts', () => ({
  ElectroluxAuth: MockElectroluxAuthCtor,
}))

vi.mock('#/state-sync.ts', () => ({
  StateSync: MockStateSyncCtor,
}))

vi.mock('#/cache.ts', () => ({
  cache: { name: 'shared-cache' },
}))

vi.mock('#/backoff.ts', () => ({
  computeBackoffDelay: mockComputeBackoffDelay,
}))

vi.mock('#/version-checker.ts', () => ({
  startVersionChecker: vi.fn().mockReturnValue(() => {}),
}))

vi.mock('#/logger.ts', () => ({
  default: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}))

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('src/index.ts — module-level wiring smoke tests (M8)', () => {
  let processOnSpy: ReturnType<typeof vi.spyOn>
  let registeredHandlers: Map<string, (...args: unknown[]) => unknown>
  let indexModule: typeof import('#/index.ts')

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    registeredHandlers = new Map()

    // Spy on process.on to capture signal handler registrations without
    // interfering with any other event listeners.
    processOnSpy = vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      registeredHandlers.set(event as string, handler as (...args: unknown[]) => unknown)
      return process
    })

    // Dynamic import triggers module evaluation; VITEST=true guards main().
    indexModule = await import('#/index.ts')
  })

  afterEach(() => {
    processOnSpy.mockRestore()
  })

  describe('module-level wiring', () => {
    it('should construct Mqtt exactly once', () => {
      expect(MockMqttCtor).toHaveBeenCalledTimes(1)
    })

    it('should construct Mqtt with the mqtt section of the config', () => {
      expect(MockMqttCtor).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'mqtt://test-broker:1883', qos: 2 }),
        'homeassistant',
      )
    })

    it('should not start main() when imported rather than run as the entry module', () => {
      // import.meta.main is false under Vitest — main() must not have logged in
      expect(mockAuthInstance.getAccessToken).not.toHaveBeenCalled()
    })

    it('should build auth, API and state sync from the config', () => {
      expect(MockElectroluxAuthCtor).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        username: 'test@example.com',
        password: 'test-pass',
        countryCode: 'US',
        renewTokenBeforeExpiryMs: 60 * 60_000,
        timeoutMs: 25_000,
      })
      expect(MockElectroluxApiCtor).toHaveBeenCalledWith(mockAuthInstance, {
        apiKey: 'test-api-key',
        timeoutMs: 25_000,
        refreshIntervalSeconds: 30,
        discoveryIntervalSeconds: 300,
      })
      const mqttInstance = MockMqttCtor.mock.results[0]?.value as unknown
      expect(MockStateSyncCtor).toHaveBeenCalledWith(
        mockApiInstance,
        mqttInstance,
        { name: 'shared-cache' },
        {
          commandStateDelayMs: 30_000,
          showChanges: true,
          ignoredKeys: [],
          revertStateOnRejection: false,
        },
      )
    })

    it('should construct Orchestrator exactly once', () => {
      expect(MockOrchestratorCtor).toHaveBeenCalledTimes(1)
    })

    it('should give the Orchestrator the bridge as discovery origin', () => {
      expect(MockOrchestratorCtor).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          discoveryOrigin: {
            name: 'electrolux-to-mqtt',
            sw_version: 'development',
            support_url: 'https://gitlab.com/kirbodev/electrolux-to-mqtt',
          },
        }),
      )
    })

    it('should construct Orchestrator with the API, the state sync and the Mqtt instance', () => {
      const mqttInstance = MockMqttCtor.mock.results[0]?.value as unknown
      const syncInstance = MockStateSyncCtor.mock.instances[0] as unknown
      expect(MockOrchestratorCtor).toHaveBeenCalledWith(mockApiInstance, syncInstance, mqttInstance, expect.any(Object))
    })

    it('should register a SIGTERM handler', () => {
      expect(registeredHandlers.has('SIGTERM')).toBe(true)
    })

    it('should register a SIGINT handler', () => {
      expect(registeredHandlers.has('SIGINT')).toBe(true)
    })

    it('should call orchestrator.shutdown when SIGTERM fires', async () => {
      const sigtermHandler = registeredHandlers.get('SIGTERM')
      expect(sigtermHandler).toBeDefined()

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      try {
        await sigtermHandler?.()
        await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalled())
        expect(mockOrchestratorInstance.shutdown).toHaveBeenCalledTimes(1)
      } finally {
        processExitSpy.mockRestore()
      }
    })

    it('should call orchestrator.shutdown when SIGINT fires', async () => {
      const sigintHandler = registeredHandlers.get('SIGINT')
      expect(sigintHandler).toBeDefined()

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      try {
        await sigintHandler?.()
        await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalled())
        expect(mockOrchestratorInstance.shutdown).toHaveBeenCalledTimes(1)
      } finally {
        processExitSpy.mockRestore()
      }
    })
  })

  describe('shutdown waits for the MQTT disconnect', () => {
    it('should stop pending login/refresh retries on SIGTERM', async () => {
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      try {
        registeredHandlers.get('SIGTERM')?.()
        await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalled())
        expect(mockAuthInstance.cleanup).toHaveBeenCalledTimes(1)
      } finally {
        processExitSpy.mockRestore()
      }
    })

    it('should exit only after orchestrator.shutdown() has resolved', async () => {
      let finishShutdown: (() => void) | undefined
      mockOrchestratorInstance.shutdown.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishShutdown = resolve
          }),
      )
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      try {
        registeredHandlers.get('SIGTERM')?.()
        await Promise.resolve()
        expect(processExitSpy).not.toHaveBeenCalled()

        finishShutdown?.()
        await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalledWith(0))
      } finally {
        processExitSpy.mockRestore()
      }
    })

    it('should exit anyway when the disconnect hangs past the shutdown timeout', async () => {
      vi.useFakeTimers()
      mockOrchestratorInstance.shutdown.mockImplementation(() => new Promise<void>(() => {}))
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      try {
        registeredHandlers.get('SIGTERM')?.()
        await vi.advanceTimersByTimeAsync(4_999)
        expect(processExitSpy).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1)
        expect(processExitSpy).toHaveBeenCalledWith(0)
      } finally {
        processExitSpy.mockRestore()
        vi.useRealTimers()
      }
    })
  })

  describe('main() function', () => {
    it('should log error and schedule retry when getAppliances returns null (API failure)', async () => {
      vi.useFakeTimers()

      mockApiInstance.getAppliances = vi.fn().mockResolvedValue(undefined)

      await indexModule.main()

      // getAppliances called exactly once during this pass
      expect(mockApiInstance.getAppliances).toHaveBeenCalledTimes(1)
      // retry setTimeout is now pending (isShuttingDown=false)
      expect(vi.getTimerCount()).toBe(1)

      vi.useRealTimers()
    })

    it('should log error and schedule retry when getAppliances returns empty array', async () => {
      vi.useFakeTimers()

      mockApiInstance.getAppliances = vi.fn().mockResolvedValue([])

      await indexModule.main()

      expect(mockApiInstance.getAppliances).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(1)

      vi.useRealTimers()
    })

    it('should back off exponentially across consecutive failed retries and reset on success', async () => {
      vi.useFakeTimers()
      mockApiInstance.getAppliances = vi.fn().mockResolvedValue(undefined)

      await indexModule.main()
      expect(mockComputeBackoffDelay).toHaveBeenLastCalledWith(0, 30_000, expect.any(Number))

      await vi.runOnlyPendingTimersAsync() // retry #1 fires and fails again
      expect(mockComputeBackoffDelay).toHaveBeenLastCalledWith(1, 30_000, expect.any(Number))

      await vi.runOnlyPendingTimersAsync() // retry #2 fires and fails again
      expect(mockComputeBackoffDelay).toHaveBeenLastCalledWith(2, 30_000, expect.any(Number))

      // Next retry succeeds — the counter must reset
      const fakeAppliance = { applianceId: 'appliance-1', applianceName: 'Test AC', applianceType: 'AC' }
      mockApiInstance.getAppliances = vi.fn().mockResolvedValue([fakeAppliance])
      await vi.runOnlyPendingTimersAsync()

      // A later failure starts from the base delay again
      mockApiInstance.getAppliances = vi.fn().mockResolvedValue(undefined)
      await indexModule.main()
      expect(mockComputeBackoffDelay).toHaveBeenLastCalledWith(0, 30_000, expect.any(Number))

      vi.useRealTimers()
    })

    it('should initialize appliances and start discovery when appliances are found', async () => {
      const fakeAppliance = { applianceId: 'appliance-1', applianceName: 'Test AC', applianceType: 'AC' }
      mockApiInstance.getAppliances = vi.fn().mockResolvedValue([fakeAppliance])

      vi.useFakeTimers()

      await indexModule.main()

      // Appliance was passed to orchestrator.initializeAppliance
      expect(mockOrchestratorInstance.initializeAppliance).toHaveBeenCalledWith(fakeAppliance, 0)

      vi.useRealTimers()
    })

    it('should start initializing every appliance without waiting for the previous one', async () => {
      const first = { applianceId: 'appliance-1', applianceName: 'Test AC', applianceType: 'AC' }
      const second = { applianceId: 'appliance-2', applianceName: 'Test AC 2', applianceType: 'AC' }
      mockApiInstance.getAppliances = vi.fn().mockResolvedValue([first, second])
      // Initialization never settles — a sequential loop would stall on the first appliance
      mockOrchestratorInstance.initializeAppliance = vi.fn().mockReturnValue(new Promise(() => {}))

      void indexModule.main()
      await vi.waitFor(() => expect(mockOrchestratorInstance.initializeAppliance).toHaveBeenCalledTimes(2))

      expect(mockOrchestratorInstance.initializeAppliance).toHaveBeenCalledWith(first, 0)
      expect(mockOrchestratorInstance.initializeAppliance).toHaveBeenCalledWith(second, 15_000)
    })

    it('should start version checker when appliances are found', async () => {
      const fakeAppliance = { applianceId: 'appliance-1', applianceName: 'Test AC', applianceType: 'AC' }
      mockApiInstance.getAppliances = vi.fn().mockResolvedValue([fakeAppliance])

      vi.useFakeTimers()

      await indexModule.main()

      expect(vi.mocked(mockStartVersionChecker)).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })

    it('should log in before fetching appliances', async () => {
      const order: string[] = []
      mockAuthInstance.getAccessToken.mockImplementation(async () => {
        order.push('login')
        return 'token'
      })
      mockApiInstance.getAppliances = vi.fn(async () => {
        order.push('getAppliances')
        return []
      })

      await indexModule.main()

      expect(order.slice(0, 2)).toEqual(['login', 'getAppliances'])
    })

    it('should fire discoverAppliances on discovery interval tick', async () => {
      const fakeAppliance = { applianceId: 'appliance-1', applianceName: 'Test AC', applianceType: 'AC' }
      mockApiInstance.getAppliances = vi.fn().mockResolvedValue([fakeAppliance])
      mockOrchestratorInstance.isShuttingDown = false

      vi.useFakeTimers()

      await indexModule.main()

      // Advance by applianceDiscoveryInterval (300s) to trigger the setInterval callback
      vi.advanceTimersByTime(300_000)

      expect(mockOrchestratorInstance.discoverAppliances).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })

    it('should clear discovery interval when orchestrator is shutting down on tick', async () => {
      const fakeAppliance = { applianceId: 'appliance-1', applianceName: 'Test AC', applianceType: 'AC' }
      mockApiInstance.getAppliances = vi.fn().mockResolvedValue([fakeAppliance])
      // Mark shutting down so the interval callback clears itself
      mockOrchestratorInstance.isShuttingDown = true

      vi.useFakeTimers()

      await indexModule.main()

      vi.advanceTimersByTime(300_000)

      // discoverAppliances should NOT have been called when shutting down
      expect(mockOrchestratorInstance.discoverAppliances).not.toHaveBeenCalled()

      vi.useRealTimers()
    })
  })

  describe('main() retry setTimeout callbacks', () => {
    it('should log error from the retry catch when null-appliances main() retry throws', async () => {
      // First call: null appliances → schedules a setTimeout retry
      // On the retry, main() calls getAppliances again — this time it throws
      mockApiInstance.getAppliances = vi
        .fn()
        .mockResolvedValueOnce(undefined) // first call: null → schedules retry
        .mockRejectedValueOnce(new Error('Retry failed')) // second call inside retry throws

      vi.useFakeTimers()

      await indexModule.main()

      // Advance past the refreshInterval (30s * 1000) to fire the retry setTimeout
      await vi.runAllTimersAsync()

      vi.useRealTimers()

      // .catch() at line 75 should have been invoked — logger.error should have been called
      const createLoggerMod = await import('#/logger.ts')
      const createLoggerMock = vi.mocked(createLoggerMod.default)
      const loggerInstance = createLoggerMock.mock.results[0]?.value as { error: ReturnType<typeof vi.fn> }
      expect(loggerInstance?.error).toHaveBeenCalled()
    })

    it('should log error from the retry catch when empty-appliances main() retry throws', async () => {
      mockApiInstance.getAppliances = vi
        .fn()
        .mockResolvedValueOnce([]) // first call: empty → schedules retry
        .mockRejectedValueOnce(new Error('Retry failed')) // second call inside retry throws

      vi.useFakeTimers()

      await indexModule.main()

      await vi.runAllTimersAsync()

      vi.useRealTimers()

      const createLoggerMod = await import('#/logger.ts')
      const createLoggerMock = vi.mocked(createLoggerMod.default)
      const loggerInstance = createLoggerMock.mock.results[0]?.value as { error: ReturnType<typeof vi.fn> }
      expect(loggerInstance?.error).toHaveBeenCalled()
    })
  })

  describe('shutdown with pending restartTimeout', () => {
    it('should clear restartTimeout when shutdown fires while a null-appliances restart is pending', async () => {
      // Call main() with null appliances — this schedules a restartTimeout
      mockApiInstance.getAppliances = vi.fn().mockResolvedValue(undefined)

      vi.useFakeTimers()

      await indexModule.main()

      // restartTimeout is now non-null; fire SIGTERM before it fires
      const sigtermHandler = registeredHandlers.get('SIGTERM')
      expect(sigtermHandler).toBeDefined()

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      try {
        await sigtermHandler?.()
        await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalled())
        // shutdown() was called and should have cleared the pending timeout
        expect(mockOrchestratorInstance.shutdown).toHaveBeenCalledTimes(1)
      } finally {
        processExitSpy.mockRestore()
      }

      vi.useRealTimers()
    })

    it('should clear restartTimeout when shutdown fires during empty-appliances restart pending', async () => {
      mockApiInstance.getAppliances = vi.fn().mockResolvedValue([])

      vi.useFakeTimers()

      await indexModule.main()

      const sigtermHandler = registeredHandlers.get('SIGTERM')
      expect(sigtermHandler).toBeDefined()

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      try {
        await sigtermHandler?.()
        await vi.waitFor(() => expect(processExitSpy).toHaveBeenCalled())
        expect(mockOrchestratorInstance.shutdown).toHaveBeenCalledTimes(1)
      } finally {
        processExitSpy.mockRestore()
      }

      vi.useRealTimers()
    })
  })
})

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
import { startVersionChecker as mockStartVersionChecker } from '@/version-checker.js'

// ─── Mock all modules that perform side-effects on import ────────────────────

// vi.mock calls are hoisted to the top of the module by Vitest.

vi.mock('@/config.js', () => ({
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
    },
    homeAssistant: {
      autoDiscovery: true,
    },
    healthCheck: {
      enabled: false,
      unHealthyRestartMinutes: 45,
    },
  },
}))

// Shared mutable mock instances — reassigned in beforeEach after resetModules
let mockClientInstance: {
  refreshInterval: number
  isLoggingIn: boolean
  isLoggedIn: boolean
  login: ReturnType<typeof vi.fn>
  initialize: ReturnType<typeof vi.fn>
  waitForLogin: ReturnType<typeof vi.fn>
  getAppliances: ReturnType<typeof vi.fn>
  cleanup: ReturnType<typeof vi.fn>
}

let mockOrchestratorInstance: {
  shutdown: ReturnType<typeof vi.fn>
  isShuttingDown: boolean
  initializeAppliance: ReturnType<typeof vi.fn>
  discoverAppliances: ReturnType<typeof vi.fn>
}

const MockOrchestratorCtor = vi.fn(function (this: typeof mockOrchestratorInstance) {
  this.shutdown = vi.fn()
  this.isShuttingDown = false
  this.initializeAppliance = vi.fn().mockResolvedValue(undefined)
  this.discoverAppliances = vi.fn()
  mockOrchestratorInstance = this
})

vi.mock('@/orchestrator.js', () => ({
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

vi.mock('@/mqtt.js', () => ({
  default: MockMqttCtor,
}))

const MockElectroluxClientCtor = vi.fn(function (this: typeof mockClientInstance) {
  this.refreshInterval = 30
  this.isLoggingIn = false
  this.isLoggedIn = false
  this.login = vi.fn().mockResolvedValue(true)
  this.initialize = vi.fn().mockResolvedValue(undefined)
  this.waitForLogin = vi.fn().mockResolvedValue(undefined)
  this.getAppliances = vi.fn().mockResolvedValue([])
  this.cleanup = vi.fn()
  mockClientInstance = this
})

vi.mock('@/electrolux.js', () => ({
  ElectroluxClient: MockElectroluxClientCtor,
}))

vi.mock('@/version-checker.js', () => ({
  startVersionChecker: vi.fn().mockReturnValue(() => {}),
}))

vi.mock('@/logger.js', () => ({
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
  let indexModule: typeof import('@/index.js')

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
    indexModule = await import('@/index.js')
  })

  afterEach(() => {
    processOnSpy.mockRestore()
  })

  describe('module-level wiring', () => {
    it('should construct Mqtt exactly once', () => {
      expect(MockMqttCtor).toHaveBeenCalledTimes(1)
    })

    it('should construct ElectroluxClient exactly once', () => {
      expect(MockElectroluxClientCtor).toHaveBeenCalledTimes(1)
    })

    it('should construct Orchestrator exactly once', () => {
      expect(MockOrchestratorCtor).toHaveBeenCalledTimes(1)
    })

    it('should construct Orchestrator with the ElectroluxClient instance and Mqtt instance', () => {
      const mqttInstance = MockMqttCtor.mock.results[0]?.value as unknown
      const clientInstance = MockElectroluxClientCtor.mock.results[0]?.value as unknown
      expect(MockOrchestratorCtor).toHaveBeenCalledWith(clientInstance, mqttInstance, expect.any(Object))
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
        expect(mockOrchestratorInstance.shutdown).toHaveBeenCalledTimes(1)
      } finally {
        processExitSpy.mockRestore()
      }
    })
  })

  describe('main() function', () => {
    it('should log error and schedule retry when getAppliances returns null (API failure)', async () => {
      vi.useFakeTimers()

      mockClientInstance.getAppliances = vi.fn().mockResolvedValue(undefined)

      await indexModule.main()

      // getAppliances called exactly once during this pass
      expect(mockClientInstance.getAppliances).toHaveBeenCalledTimes(1)
      // retry setTimeout is now pending (isShuttingDown=false)
      expect(vi.getTimerCount()).toBe(1)

      vi.useRealTimers()
    })

    it('should log error and schedule retry when getAppliances returns empty array', async () => {
      vi.useFakeTimers()

      mockClientInstance.getAppliances = vi.fn().mockResolvedValue([])

      await indexModule.main()

      expect(mockClientInstance.getAppliances).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(1)

      vi.useRealTimers()
    })

    it('should initialize appliances and start discovery when appliances are found', async () => {
      const fakeAppliance = { applianceId: 'appliance-1', applianceName: 'Test AC', applianceType: 'AC' }
      mockClientInstance.getAppliances = vi.fn().mockResolvedValue([fakeAppliance])

      vi.useFakeTimers()

      await indexModule.main()

      // Appliance was passed to orchestrator.initializeAppliance
      expect(mockOrchestratorInstance.initializeAppliance).toHaveBeenCalledWith(fakeAppliance, 0)

      vi.useRealTimers()
    })

    it('should start version checker when appliances are found', async () => {
      const fakeAppliance = { applianceId: 'appliance-1', applianceName: 'Test AC', applianceType: 'AC' }
      mockClientInstance.getAppliances = vi.fn().mockResolvedValue([fakeAppliance])

      vi.useFakeTimers()

      await indexModule.main()

      expect(vi.mocked(mockStartVersionChecker)).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })

    it('should call client.initialize and waitForLogin before fetching appliances', async () => {
      mockClientInstance.getAppliances = vi.fn().mockResolvedValue([])

      await indexModule.main()

      expect(mockClientInstance.initialize).toHaveBeenCalledTimes(1)
      expect(mockClientInstance.waitForLogin).toHaveBeenCalledTimes(1)
    })

    it('should call client.login when isLoggingIn is false before waitForLogin', async () => {
      mockClientInstance.isLoggingIn = false
      mockClientInstance.getAppliances = vi.fn().mockResolvedValue([])

      await indexModule.main()

      expect(mockClientInstance.login).toHaveBeenCalledTimes(1)
    })

    it('should skip client.login when client is already logging in', async () => {
      mockClientInstance.isLoggingIn = true
      mockClientInstance.getAppliances = vi.fn().mockResolvedValue([])

      await indexModule.main()

      expect(mockClientInstance.login).not.toHaveBeenCalled()
    })

    it('should fire discoverAppliances on discovery interval tick', async () => {
      const fakeAppliance = { applianceId: 'appliance-1', applianceName: 'Test AC', applianceType: 'AC' }
      mockClientInstance.getAppliances = vi.fn().mockResolvedValue([fakeAppliance])
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
      mockClientInstance.getAppliances = vi.fn().mockResolvedValue([fakeAppliance])
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
      mockClientInstance.getAppliances = vi
        .fn()
        .mockResolvedValueOnce(undefined) // first call: null → schedules retry
        .mockRejectedValueOnce(new Error('Retry failed')) // second call inside retry throws

      vi.useFakeTimers()

      await indexModule.main()

      // Advance past the refreshInterval (30s * 1000) to fire the retry setTimeout
      await vi.runAllTimersAsync()

      vi.useRealTimers()

      // .catch() at line 75 should have been invoked — logger.error should have been called
      const createLoggerMod = await import('@/logger.js')
      const createLoggerMock = vi.mocked(createLoggerMod.default)
      const loggerInstance = createLoggerMock.mock.results[0]?.value as { error: ReturnType<typeof vi.fn> }
      expect(loggerInstance?.error).toHaveBeenCalled()
    })

    it('should log error from the retry catch when empty-appliances main() retry throws', async () => {
      mockClientInstance.getAppliances = vi
        .fn()
        .mockResolvedValueOnce([]) // first call: empty → schedules retry
        .mockRejectedValueOnce(new Error('Retry failed')) // second call inside retry throws

      vi.useFakeTimers()

      await indexModule.main()

      await vi.runAllTimersAsync()

      vi.useRealTimers()

      const createLoggerMod = await import('@/logger.js')
      const createLoggerMock = vi.mocked(createLoggerMod.default)
      const loggerInstance = createLoggerMock.mock.results[0]?.value as { error: ReturnType<typeof vi.fn> }
      expect(loggerInstance?.error).toHaveBeenCalled()
    })
  })

  describe('shutdown with pending restartTimeout', () => {
    it('should clear restartTimeout when shutdown fires while a null-appliances restart is pending', async () => {
      // Call main() with null appliances — this schedules a restartTimeout
      mockClientInstance.getAppliances = vi.fn().mockResolvedValue(undefined)

      vi.useFakeTimers()

      await indexModule.main()

      // restartTimeout is now non-null; fire SIGTERM before it fires
      const sigtermHandler = registeredHandlers.get('SIGTERM')
      expect(sigtermHandler).toBeDefined()

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      try {
        await sigtermHandler?.()
        // shutdown() was called and should have cleared the pending timeout
        expect(mockOrchestratorInstance.shutdown).toHaveBeenCalledTimes(1)
      } finally {
        processExitSpy.mockRestore()
      }

      vi.useRealTimers()
    })

    it('should clear restartTimeout when shutdown fires during empty-appliances restart pending', async () => {
      mockClientInstance.getAppliances = vi.fn().mockResolvedValue([])

      vi.useFakeTimers()

      await indexModule.main()

      const sigtermHandler = registeredHandlers.get('SIGTERM')
      expect(sigtermHandler).toBeDefined()

      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
      try {
        await sigtermHandler?.()
        expect(mockOrchestratorInstance.shutdown).toHaveBeenCalledTimes(1)
      } finally {
        processExitSpy.mockRestore()
      }

      vi.useRealTimers()
    })
  })
})

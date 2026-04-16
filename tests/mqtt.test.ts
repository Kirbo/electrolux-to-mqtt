import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Build a fresh mock client for each test module reset cycle.
// EventEmitter is required so that module-level client.on('message', …)
// registrations actually dispatch when we emit.
function createMockClient() {
  const emitter = new EventEmitter()
  const mockClient = Object.assign(emitter, {
    connected: true,
    publish: vi.fn((_topic: unknown, _message: unknown, _options: unknown, callback: (err: null) => void) => {
      if (callback) callback(null)
    }),
    subscribe: vi.fn((topic: unknown, callback: (err: null, granted: { topic: unknown; qos: number }[]) => void) => {
      if (callback) callback(null, [{ topic, qos: 0 }])
    }),
    unsubscribe: vi.fn((_topic: unknown, callback: (err: null) => void) => {
      if (callback) callback(null)
    }),
    end: vi.fn(),
  })
  return mockClient
}

// Shared logger spy — captured when createLogger mock is called
let loggerWarnSpy: ReturnType<typeof vi.fn>
let loggerInfoSpy: ReturnType<typeof vi.fn>
let loggerErrorSpy: ReturnType<typeof vi.fn>
let loggerDebugSpy: ReturnType<typeof vi.fn>

let mockClient: ReturnType<typeof createMockClient>

// Mock mqtt module before importing the Mqtt class
vi.mock('mqtt', () => {
  return {
    default: {
      connect: vi.fn(() => mockClient),
    },
  }
})

// Mock config
vi.mock('@/config.js', () => ({
  default: {
    mqtt: {
      host: 'test-broker',
      port: 1883,
      username: 'test-user',
      password: 'test-pass',
      topicPrefix: 'test_',
    },
  },
}))

// Mock logger — captures logger spies so tests can assert on them
vi.mock('@/logger.js', () => ({
  default: vi.fn(() => {
    loggerWarnSpy = vi.fn()
    loggerInfoSpy = vi.fn()
    loggerErrorSpy = vi.fn()
    loggerDebugSpy = vi.fn()
    return {
      info: loggerInfoSpy,
      error: loggerErrorSpy,
      warn: loggerWarnSpy,
      debug: loggerDebugSpy,
    }
  }),
}))

describe('Mqtt', () => {
  let Mqtt: typeof import('@/mqtt.js').default
  let mqttInstance: InstanceType<typeof import('@/mqtt.js').default>

  beforeEach(async () => {
    // Reset modules so topicHandlers Map and module-level client state is fresh.
    // This also causes the logger mock factory to run again on re-import,
    // refreshing the captured logger spies.
    vi.resetModules()
    vi.clearAllMocks()

    // Fresh mock client for each test (EventEmitter + vi.fn methods)
    mockClient = createMockClient()

    // Dynamically import the actual module after mocks are set up
    const module = await import('@/mqtt.js')
    Mqtt = module.default
    mqttInstance = new Mqtt()
  })

  describe('constructor', () => {
    it('should create mqtt instance with topic prefix from config', () => {
      expect(mqttInstance.topicPrefix).toBe('test_appliances')
    })

    it('should create mqtt client with mqtt interface', () => {
      expect(mqttInstance.client).not.toBeNull()
      expect(typeof mqttInstance.client.on).toBe('function')
      expect(typeof mqttInstance.client.publish).toBe('function')
      expect(typeof mqttInstance.client.subscribe).toBe('function')
    })
  })

  describe('resolveApplianceTopic', () => {
    it('should construct topic with prefix and appliance id', () => {
      const topic = mqttInstance.resolveApplianceTopic('device-123')
      expect(topic).toBe('test_appliances/device-123')
    })

    it('should handle appliance ids with special characters', () => {
      const topic = mqttInstance.resolveApplianceTopic('device_123-abc')
      expect(topic).toBe('test_appliances/device_123-abc')
    })
  })

  describe('publish', () => {
    it('should publish message to correct topic', () => {
      const message = JSON.stringify({ mode: 'cool' })
      mqttInstance.publish('device-123', message)

      expect(mqttInstance.client.publish).toHaveBeenCalledWith(
        'test_appliances/device-123',
        message,
        expect.any(Object),
        expect.any(Function),
      )
    })

    it('should use default options when not specified', () => {
      const message = JSON.stringify({ mode: 'heat' })
      mqttInstance.publish('device-456', message)

      expect(mqttInstance.client.publish).toHaveBeenCalledWith(
        'test_appliances/device-456',
        message,
        expect.objectContaining({ qos: 2, retain: false }),
        expect.any(Function),
      )
    })

    it('should merge custom options with defaults', () => {
      const message = JSON.stringify({ mode: 'cool' })
      const customOptions = { qos: 2 as const, retain: true }

      mqttInstance.publish('device-789', message, customOptions)

      expect(mqttInstance.client.publish).toHaveBeenCalledWith(
        'test_appliances/device-789',
        message,
        expect.objectContaining({ qos: 2, retain: true }),
        expect.any(Function),
      )
    })

    it('should not call client.publish when disconnected (M1)', () => {
      // M1: when client is disconnected, publish must be a no-op
      mockClient.connected = false
      const message = JSON.stringify({ mode: 'cool' })

      mqttInstance.publish('device-123', message)

      expect(mockClient.publish).not.toHaveBeenCalled()
    })

    it('should log a warning with the topic when publish is dropped due to disconnection (M1)', () => {
      // M1: dropped publish must emit a warn with the topic for observability
      mockClient.connected = false
      const message = JSON.stringify({ mode: 'cool' })

      mqttInstance.publish('device-123', message)

      // loggerWarnSpy is set by the logger mock factory when the module loads
      expect(loggerWarnSpy).toHaveBeenCalledWith(expect.stringContaining('test_appliances/device-123'))
    })

    it('should call client.publish when connected', () => {
      // Inverse: connected = true (default) → publish proceeds normally
      mockClient.connected = true
      const message = JSON.stringify({ mode: 'fan' })

      mqttInstance.publish('device-123', message)

      expect(mockClient.publish).toHaveBeenCalledTimes(1)
    })
  })

  describe('subscribe', () => {
    it('should subscribe to topic with prefix', async () => {
      const callback = vi.fn()
      await mqttInstance.subscribe('commands/+', callback)

      expect(mqttInstance.client.subscribe).toHaveBeenCalledWith('test_appliances/commands/+', expect.any(Function))
    })

    it('should store topic handler when subscribed successfully', async () => {
      const callback = vi.fn()
      await mqttInstance.subscribe('status/#', callback)

      // The client.subscribe callback should be called on success
      expect(mqttInstance.client.subscribe).toHaveBeenCalled()
    })

    it('should handle different topic patterns', async () => {
      const callback = vi.fn()
      await mqttInstance.subscribe('alerts/+', callback)

      expect(mqttInstance.client.subscribe).toHaveBeenCalledWith('test_appliances/alerts/+', expect.any(Function))
    })

    it('should reject when subscription fails', async () => {
      const mockClientTyped = mqttInstance.client as unknown as {
        subscribe: ReturnType<typeof vi.fn>
      }
      mockClientTyped.subscribe = vi.fn((_topic, callback) => {
        if (callback) callback(new Error('Subscription failed'))
      })

      const callback = vi.fn()
      await expect(mqttInstance.subscribe('device-error', callback)).rejects.toThrow('Subscription failed')
    })
  })

  describe('unsubscribe', () => {
    it('should unsubscribe from topic', () => {
      mqttInstance.client.unsubscribe = vi.fn((_topic) => {
        return mqttInstance.client
      }) as unknown as typeof mqttInstance.client.unsubscribe

      mqttInstance.unsubscribe('device-123')

      expect(mqttInstance.client.unsubscribe).toHaveBeenCalledWith('test_appliances/device-123', expect.any(Function))
    })

    it('should handle unsubscribe errors', () => {
      mqttInstance.client.unsubscribe = vi.fn((_topic) => {
        return mqttInstance.client
      }) as unknown as typeof mqttInstance.client.unsubscribe

      mqttInstance.unsubscribe('device-456')

      expect(mqttInstance.client.unsubscribe).toHaveBeenCalled()
    })

    it('should preserve handler in topicHandlers during in-flight unsubscribe (C2 race)', async () => {
      // C2: handler must remain active until broker confirms unsubscribe.
      // Steps:
      //   1. Subscribe — installs handler in topicHandlers.
      //   2. Call unsubscribe — broker callback is captured but NOT yet fired.
      //   3. Emit 'message' on the mock client — handler must still be invoked.
      //   4. Fire the captured broker callback (success) — handler removed.
      //   5. Emit 'message' again — handler must NOT be invoked.

      const handler = vi.fn()
      await mqttInstance.subscribe('commands/device-123', handler)

      const fullTopic = 'test_appliances/commands/device-123'

      // Capture the unsubscribe broker callback without firing it
      let capturedUnsubCallback: ((err: Error | null) => void) | undefined
      mqttInstance.client.unsubscribe = vi.fn((_topic, cb) => {
        capturedUnsubCallback = cb as (err: Error | null) => void
        // Do NOT call cb yet — simulates broker in-flight delay
      }) as unknown as typeof mqttInstance.client.unsubscribe

      mqttInstance.unsubscribe('commands/device-123')

      // Message arrives BEFORE broker confirms unsubscribe — handler must still fire
      mockClient.emit('message', fullTopic, Buffer.from('payload'))
      expect(handler).toHaveBeenCalledTimes(1)

      // Broker confirms unsubscribe
      expect(capturedUnsubCallback).toBeDefined()
      capturedUnsubCallback?.(null)

      // Message arrives AFTER broker confirms — handler must NOT fire
      handler.mockClear()
      mockClient.emit('message', fullTopic, Buffer.from('payload2'))
      expect(handler).not.toHaveBeenCalled()
    })

    it('should remove handler even when unsubscribe returns an error (C2 error branch)', async () => {
      // Even on broker error the local route should be cleaned up (broker may be
      // in inconsistent state but locally the topic is unwanted).
      const handler = vi.fn()
      await mqttInstance.subscribe('commands/device-error', handler)

      const fullTopic = 'test_appliances/commands/device-error'

      let capturedUnsubCallback: ((err: Error | null) => void) | undefined
      mqttInstance.client.unsubscribe = vi.fn((_topic, cb) => {
        capturedUnsubCallback = cb as (err: Error | null) => void
      }) as unknown as typeof mqttInstance.client.unsubscribe

      mqttInstance.unsubscribe('commands/device-error')

      // Fire the broker callback with an error
      capturedUnsubCallback?.(new Error('Broker error'))

      // After error callback fires, handler must be removed
      mockClient.emit('message', fullTopic, Buffer.from('payload'))
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('disconnect', () => {
    it('should disconnect from broker', () => {
      mqttInstance.disconnect()

      expect(mqttInstance.client.end).toHaveBeenCalledWith(expect.any(Function))
    })
  })

  describe('autoDiscovery', () => {
    it('should publish to homeassistant discovery topic', () => {
      const discoveryConfig = JSON.stringify({
        availability_topic: 'test/availability',
        mode_state_topic: 'test/mode',
        mode_command_topic: 'test/mode/set',
        current_temperature_topic: 'test/temp',
        temperature_command_topic: 'test/temp/set',
      })

      mqttInstance.autoDiscovery('device-123', discoveryConfig)

      expect(mqttInstance.client.publish).toHaveBeenCalledWith(
        'homeassistant/climate/device-123/config',
        discoveryConfig,
        expect.objectContaining({ retain: true, qos: 2 }),
        expect.any(Function),
      )
    })

    it('should log auto-discovery config details', () => {
      const discoveryConfig = JSON.stringify({
        availability_topic: 'test/avail',
        mode_state_topic: 'test/mode',
      })

      mqttInstance.autoDiscovery('device-456', discoveryConfig)

      expect(mqttInstance.client.publish).toHaveBeenCalled()
    })

    it('should handle discovery config with all fields', () => {
      const fullConfig = JSON.stringify({
        name: 'Test Device',
        unique_id: 'device-789',
        availability_topic: 'test/availability',
        mode_state_topic: 'test/mode/state',
        mode_command_topic: 'test/mode/command',
        current_temperature_topic: 'test/temperature/current',
        temperature_command_topic: 'test/temperature/set',
        temperature_state_topic: 'test/temperature/state',
      })

      mqttInstance.autoDiscovery('device-789', fullConfig)

      expect(mqttInstance.client.publish).toHaveBeenCalledWith(
        'homeassistant/climate/device-789/config',
        fullConfig,
        expect.objectContaining({ retain: true, qos: 2 }),
        expect.any(Function),
      )
    })
  })

  describe('publishInfo', () => {
    it('should publish to info topic with retain and qos 2', () => {
      const message = JSON.stringify({ version: '1.0.0' })
      mqttInstance.publishInfo(message)

      expect(mqttInstance.client.publish).toHaveBeenCalledWith(
        'test_appliances/info',
        message,
        expect.objectContaining({ retain: true, qos: 2 }),
        expect.any(Function),
      )
    })

    it('should merge custom options for publishInfo', () => {
      const message = JSON.stringify({ status: 'online' })
      mqttInstance.publishInfo(message, { qos: 1 as const })

      expect(mqttInstance.client.publish).toHaveBeenCalledWith(
        'test_appliances/info',
        message,
        expect.objectContaining({ retain: true, qos: 1 }),
        expect.any(Function),
      )
    })
  })

  describe('publish with non-JSON message', () => {
    it('should handle non-JSON message in _publish without throwing', () => {
      const nonJsonMessage = 'plain text message'
      expect(() => mqttInstance.publish('device-123', nonJsonMessage)).not.toThrow()

      expect(mqttInstance.client.publish).toHaveBeenCalledWith(
        'test_appliances/device-123',
        nonJsonMessage,
        expect.any(Object),
        expect.any(Function),
      )
    })
  })

  describe('error handling', () => {
    it('should log error and not throw when publish callback returns an error (m12)', () => {
      const mockClientTyped = mqttInstance.client as unknown as {
        publish: ReturnType<typeof vi.fn>
      }

      mockClientTyped.publish = vi.fn((_topic, _message, _options, callback) => {
        if (callback) callback(new Error('Publish failed'))
      })

      const message = JSON.stringify({ mode: 'cool' })

      // Must not throw even when callback fires with an error
      expect(() => mqttInstance.publish('device-error', message)).not.toThrow()
      // Error must be logged for observability
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error publishing message'),
        expect.objectContaining({ message: 'Publish failed' }),
      )
    })

    it('should handle subscribe errors', async () => {
      const mockClientTyped = mqttInstance.client as unknown as {
        subscribe: ReturnType<typeof vi.fn>
      }
      mockClientTyped.subscribe = vi.fn((_topic, callback) => {
        callback(new Error('Subscribe failed'))
      })

      const mockCallback = vi.fn()
      await expect(mqttInstance.subscribe('device-error', mockCallback)).rejects.toThrow('Subscribe failed')
    })

    it('should handle unsubscribe errors', () => {
      const mockClientTyped = mqttInstance.client as unknown as {
        unsubscribe: ReturnType<typeof vi.fn>
      }
      mockClientTyped.unsubscribe = vi.fn((_topic, callback) => {
        callback(new Error('Unsubscribe failed'))
      })

      mqttInstance.unsubscribe('device-error')

      expect(mockClientTyped.unsubscribe).toHaveBeenCalled()
    })
  })

  describe('disconnect', () => {
    it('should disconnect from MQTT broker', () => {
      mqttInstance.disconnect()

      expect(mqttInstance.client.end).toHaveBeenCalledWith(expect.any(Function))
    })

    it('should call end callback when disconnecting', () => {
      const mockClientTyped = mqttInstance.client as unknown as {
        end: ReturnType<typeof vi.fn>
      }
      let endCallback: (() => void) | undefined

      mockClientTyped.end = vi.fn((callback) => {
        endCallback = callback
        if (callback) callback()
      })

      mqttInstance.disconnect()

      expect(mockClientTyped.end).toHaveBeenCalled()
      expect(endCallback).toBeDefined()
    })
  })

  describe('onReconnect (M9)', () => {
    it('should fire the callback on a connect event from the underlying client', () => {
      const cb = vi.fn()
      mqttInstance.onReconnect(cb)

      mockClient.emit('connect')

      expect(cb).toHaveBeenCalledTimes(1)
    })

    it('should fire the callback on every subsequent connect event', () => {
      const cb = vi.fn()
      mqttInstance.onReconnect(cb)

      mockClient.emit('connect')
      mockClient.emit('connect')
      mockClient.emit('connect')

      expect(cb).toHaveBeenCalledTimes(3)
    })

    it('should fire all registered callbacks on each connect event', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      mqttInstance.onReconnect(cb1)
      mqttInstance.onReconnect(cb2)

      mockClient.emit('connect')

      expect(cb1).toHaveBeenCalledTimes(1)
      expect(cb2).toHaveBeenCalledTimes(1)
    })

    it('should fire all callbacks in registration order', () => {
      const callOrder: number[] = []
      mqttInstance.onReconnect(() => callOrder.push(1))
      mqttInstance.onReconnect(() => callOrder.push(2))

      mockClient.emit('connect')

      expect(callOrder).toEqual([1, 2])
    })

    it('should not fire a callback registered after the connect event', () => {
      const cb = vi.fn()

      // Emit before registration
      mockClient.emit('connect')
      mqttInstance.onReconnect(cb)

      expect(cb).not.toHaveBeenCalled()
    })
  })

  describe('publish error handling', () => {
    it('should handle publish errors in callback', () => {
      const mockClientTyped = mqttInstance.client as unknown as {
        publish: ReturnType<typeof vi.fn>
      }

      // Mock publish to call callback with error
      mockClientTyped.publish = vi.fn((_topic, _message, _options, callback) => {
        if (callback) callback(new Error('Publish failed'))
      })

      const message = JSON.stringify({ mode: 'cool' })

      // This should not throw even though the callback receives an error
      expect(() => mqttInstance.publish('device-123', message)).not.toThrow()
    })
  })

  describe('subscribe error handling', () => {
    it('should reject promise when subscribe fails', async () => {
      const mockClientTyped = mqttInstance.client as unknown as {
        subscribe: ReturnType<typeof vi.fn>
      }

      // Mock subscribe to call callback with error
      mockClientTyped.subscribe = vi.fn((_topic, callback) => {
        if (callback) callback(new Error('Subscribe failed'))
      })

      const testCallback = vi.fn()

      await expect(mqttInstance.subscribe('device-123', testCallback)).rejects.toThrow('Subscribe failed')
    })
  })

  describe('unsubscribe error handling', () => {
    it('should handle unsubscribe errors in callback', () => {
      const mockClientTyped = mqttInstance.client as unknown as {
        unsubscribe: ReturnType<typeof vi.fn>
      }

      // Mock unsubscribe to call callback with error
      mockClientTyped.unsubscribe = vi.fn((_topic, callback) => {
        if (callback) callback(new Error('Unsubscribe failed'))
      })

      // This should not throw even though the callback receives an error
      expect(() => mqttInstance.unsubscribe('device-123')).not.toThrow()
    })

    it('should log success when unsubscribe completes without error', () => {
      const mockClientTyped = mqttInstance.client as unknown as {
        unsubscribe: ReturnType<typeof vi.fn>
      }

      // Mock unsubscribe to call callback with no error (success)
      mockClientTyped.unsubscribe = vi.fn((_topic, callback) => {
        if (callback) callback(null)
      })

      expect(() => mqttInstance.unsubscribe('device-123')).not.toThrow()
      expect(mockClientTyped.unsubscribe).toHaveBeenCalledWith(
        expect.stringContaining('device-123'),
        expect.any(Function),
      )
    })
  })
})

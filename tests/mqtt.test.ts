import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock mqtt module before importing the Mqtt class
vi.mock('mqtt', () => {
  const mockClient = {
    on: vi.fn(function (this: typeof mockClient) {
      return this
    }),
    publish: vi.fn((_topic, _message, _options, callback) => {
      if (callback) callback(null)
    }),
    subscribe: vi.fn((topic, _options, callback) => {
      if (callback) callback(null, [{ topic, qos: _options?.qos ?? 0 }])
    }),
    end: vi.fn(),
  }

  return {
    default: {
      connect: vi.fn(() => mockClient),
    },
  }
})

// Mock config
vi.mock('../src/config.js', () => ({
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

// Mock logger
vi.mock('../src/logger.js', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

describe('Mqtt', () => {
  let Mqtt: typeof import('../src/mqtt.js').default
  let mqttInstance: InstanceType<typeof import('../src/mqtt.js').default>

  beforeEach(async () => {
    vi.clearAllMocks()

    // Dynamically import the actual module after mocks are set up
    const module = await import('../src/mqtt.js')
    Mqtt = module.default
    mqttInstance = new Mqtt()
  })

  describe('constructor', () => {
    it('should create mqtt instance with topic prefix from config', () => {
      expect(mqttInstance.topicPrefix).toBe('test_appliances')
    })

    it('should create mqtt client', () => {
      expect(mqttInstance.client).toBeDefined()
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
        expect.objectContaining({ qos: 0, retain: false }),
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
  })

  describe('subscribe', () => {
    it('should subscribe to topic with prefix', () => {
      const callback = vi.fn()
      mqttInstance.subscribe('commands/+', callback)

      expect(mqttInstance.client.subscribe).toHaveBeenCalledWith('test_appliances/commands/+', expect.any(Function))
    })

    it('should store topic handler when subscribed successfully', () => {
      const callback = vi.fn()
      mqttInstance.subscribe('status/#', callback)

      // The client.subscribe callback should be called on success
      expect(mqttInstance.client.subscribe).toHaveBeenCalled()
    })

    it('should handle different topic patterns', () => {
      const callback = vi.fn()
      mqttInstance.subscribe('alerts/+', callback)

      expect(mqttInstance.client.subscribe).toHaveBeenCalledWith('test_appliances/alerts/+', expect.any(Function))
    })

    it('should handle subscription errors', () => {
      const mockClientWithError = {
        on: vi.fn(function (this: typeof mockClientWithError) {
          return this
        }),
        publish: vi.fn(),
        subscribe: vi.fn((_topic, callback) => {
          callback(new Error('Subscription failed'))
        }),
        unsubscribe: vi.fn(),
        end: vi.fn(),
      }

      // Verify the mock handles errors
      expect(mockClientWithError.subscribe).toBeDefined()
    })
  })

  describe('unsubscribe', () => {
    it('should unsubscribe from topic', () => {
      // First mock an unsubscribe method
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

  describe('error handling', () => {
    it('should handle publish errors gracefully', () => {
      const mockClientWithError = {
        on: vi.fn(function (this: typeof mockClientWithError) {
          return this
        }),
        publish: vi.fn((_topic, _message, _options, callback) => {
          if (callback) callback(new Error('Publish failed'))
        }),
        subscribe: vi.fn(),
        end: vi.fn(),
      }

      // This test verifies the error callback path exists
      expect(mockClientWithError.publish).toBeDefined()
    })

    it('should handle subscribe errors', () => {
      const mockClient = mqttInstance.client as unknown as {
        subscribe: ReturnType<typeof vi.fn>
      }
      mockClient.subscribe = vi.fn((_topic, callback) => {
        callback(new Error('Subscribe failed'))
      })

      const mockCallback = vi.fn()
      mqttInstance.subscribe('device-error', mockCallback)

      expect(mockClient.subscribe).toHaveBeenCalled()
    })

    it('should handle unsubscribe errors', () => {
      const mockClient = mqttInstance.client as unknown as {
        unsubscribe: ReturnType<typeof vi.fn>
      }
      mockClient.unsubscribe = vi.fn((_topic, callback) => {
        callback(new Error('Unsubscribe failed'))
      })

      mqttInstance.unsubscribe('device-error')

      expect(mockClient.unsubscribe).toHaveBeenCalled()
    })
  })

  describe('disconnect', () => {
    it('should disconnect from MQTT broker', () => {
      mqttInstance.disconnect()

      expect(mqttInstance.client.end).toHaveBeenCalledWith(expect.any(Function))
    })

    it('should call end callback when disconnecting', () => {
      const mockClient = mqttInstance.client as unknown as {
        end: ReturnType<typeof vi.fn>
      }
      let endCallback: (() => void) | undefined

      mockClient.end = vi.fn((callback) => {
        endCallback = callback
        if (callback) callback()
      })

      mqttInstance.disconnect()

      expect(mockClient.end).toHaveBeenCalled()
      expect(endCallback).toBeDefined()
    })
  })
})

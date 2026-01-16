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
  })
})

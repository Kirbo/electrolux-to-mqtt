import { describe, expect, it, vi } from 'vitest'

// Store event handlers
const eventHandlers = new Map<string, (...args: unknown[]) => void>()

// Create mock client at top level before vi.mock
const mockClient = {
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    eventHandlers.set(event, handler)
    return mockClient
  }),
  publish: vi.fn((_topic, _message, _options, callback) => {
    if (callback) callback(null)
  }),
  subscribe: vi.fn((_topic, callback) => {
    if (callback) callback(null)
  }),
  unsubscribe: vi.fn((_topic, callback) => {
    if (callback) callback(null)
  }),
  end: vi.fn((callback) => {
    if (callback) callback()
  }),
}

// Mock mqtt before any imports
vi.mock('mqtt', () => ({
  default: {
    connect: vi.fn(() => mockClient),
  },
}))

const MQTT_SETTINGS = {
  url: 'mqtt://test-broker:1883',
  clientId: 'test-client',
  username: 'test-user',
  password: 'test-pass',
  topicPrefix: 'test_',
  retain: false,
  qos: 2,
}

/** Constructing a client is what registers its event handlers. */
const createClient = async () => {
  const Mqtt = (await import('#/mqtt.js')).default
  return new Mqtt(MQTT_SETTINGS)
}

// Mock logger
vi.mock('#/logger.js', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}))

describe('MQTT Module Event Handlers', () => {
  it('should execute connect event handler', async () => {
    await createClient()

    const connectHandler = eventHandlers.get('connect')
    expect(connectHandler).toBeDefined()

    // Execute it - should not throw
    expect(() => connectHandler?.()).not.toThrow()
  })

  it('should execute error event handler', async () => {
    await createClient()

    const errorHandler = eventHandlers.get('error')
    expect(errorHandler).toBeDefined()

    expect(() => errorHandler?.(new Error('Test error'))).not.toThrow()
  })

  it('should execute reconnect event handler', async () => {
    await createClient()

    const reconnectHandler = eventHandlers.get('reconnect')
    expect(reconnectHandler).toBeDefined()

    expect(() => reconnectHandler?.()).not.toThrow()
  })

  it('should execute close event handler', async () => {
    await createClient()

    const closeHandler = eventHandlers.get('close')
    expect(closeHandler).toBeDefined()

    expect(() => closeHandler?.()).not.toThrow()
  })

  it('should execute offline event handler', async () => {
    await createClient()

    const offlineHandler = eventHandlers.get('offline')
    expect(offlineHandler).toBeDefined()

    expect(() => offlineHandler?.()).not.toThrow()
  })

  it('should execute end event handler', async () => {
    await createClient()

    const endHandler = eventHandlers.get('end')
    expect(endHandler).toBeDefined()

    expect(() => endHandler?.()).not.toThrow()
  })

  it('should execute message event handler with subscribed topic', async () => {
    const mqttInstance = await createClient()

    const messageHandler = eventHandlers.get('message')
    expect(messageHandler).toBeDefined()

    // Subscribe to a topic
    const testCallback = vi.fn()
    await mqttInstance.subscribe('device-123', testCallback)

    // Trigger message handler
    const testTopic = 'test_appliances/device-123'
    const testMessage = Buffer.from('test message')
    messageHandler?.(testTopic, testMessage)

    expect(testCallback).toHaveBeenCalledWith(testTopic, testMessage)
  })

  it('should handle message event without subscribed topic', async () => {
    await createClient()

    const messageHandler = eventHandlers.get('message')
    expect(messageHandler).toBeDefined()

    // Send message to unsubscribed topic - should not throw
    expect(() => messageHandler?.('unknown/topic', Buffer.from('test'))).not.toThrow()
  })

  it('should catch errors in message topic handler', async () => {
    const mqttInstance = await createClient()

    const messageHandler = eventHandlers.get('message')
    expect(messageHandler).toBeDefined()

    // Create a handler that throws
    const errorCallback = vi.fn(() => {
      throw new Error('Handler error')
    })

    await mqttInstance.subscribe('error-device', errorCallback)

    // Should catch the error and not throw
    expect(() => messageHandler?.('test_appliances/error-device', Buffer.from('test'))).not.toThrow()
    expect(errorCallback).toHaveBeenCalled()
  })

  it('should handle publish error callback', async () => {
    const mqttInstance = await createClient()

    // Mock publish to call callback with error
    mockClient.publish = vi.fn((_topic, _message, _options, callback) => {
      if (callback) callback(new Error('Publish failed') as never)
    })

    const message = JSON.stringify({ test: 'data' })

    // Should not throw even with error in callback
    expect(() => mqttInstance.publish('device-123', message)).not.toThrow()
  })

  it('should reject promise on subscribe error callback', async () => {
    const mqttInstance = await createClient()

    // Mock subscribe to call callback with error
    mockClient.subscribe = vi.fn((_topic, callback) => {
      if (callback) callback(new Error('Subscribe failed') as never)
    })

    const testCallback = vi.fn()

    // Should reject the promise with the subscribe error
    await expect(mqttInstance.subscribe('device-123', testCallback)).rejects.toThrow('Subscribe failed')
  })

  it('should handle unsubscribe error callback', async () => {
    const mqttInstance = await createClient()

    // Mock unsubscribe to call callback with error
    mockClient.unsubscribe = vi.fn((_topic, callback) => {
      if (callback) callback(new Error('Unsubscribe failed') as never)
    })

    // Should not throw even with error in callback
    expect(() => mqttInstance.unsubscribe('device-123')).not.toThrow()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Cache } from '#/cache.ts'
import type { NormalizedState } from '#/types/normalized.ts'

describe('Cache', () => {
  const state = (overrides: Record<string, unknown> = {}) =>
    ({
      applianceId: 'appliance-1',
      mode: 'cool',
      applianceState: 'on',
      targetTemperatureC: 22,
      ...overrides,
    }) as NormalizedState

  it('round-trips a normalized state per appliance', () => {
    const cache = new Cache()
    cache.setState('appliance-1', state())

    expect(cache.getState('appliance-1')).toEqual(state())
    expect(cache.getState('appliance-2')).toBeNull()
  })

  it('returns a copy, not the stored object', () => {
    const cache = new Cache()
    const original = state()
    cache.setState('appliance-1', original)
    original.targetTemperatureC = 30

    expect(cache.getState('appliance-1')?.targetTemperatureC).toBe(22)
  })

  it('does not return a non-normalized value stored under the state key', () => {
    const cache = new Cache()
    // e.g. a raw API shape written through matchByValue — never a valid state
    cache.matchByValue(cache.cacheKey('appliance-1').state, { applianceId: 'appliance-1', properties: {} })

    expect(cache.getState('appliance-1')).toBeNull()
  })

  it('forgets a state once its key is deleted', () => {
    const cache = new Cache()
    cache.setState('appliance-1', state())

    cache.delete(cache.cacheKey('appliance-1').state)
    expect(cache.getState('appliance-1')).toBeNull()
  })

  it('returns the cache instance from setState and delete for chaining', () => {
    const cache = new Cache()
    expect(cache.setState('a', state()).setState('b', state()).delete('a')).toBe(cache)
  })

  it('should detect when value has not changed', () => {
    const cache = new Cache()
    const value = { name: 'test' }

    // First call should return false (value changed/new)
    expect(cache.matchByValue('key', value)).toBe(false)

    // Second call with same value should return true (no change)
    expect(cache.matchByValue('key', value)).toBe(true)
  })

  it('should detect when value has changed', () => {
    const cache = new Cache()

    cache.matchByValue('key', { temp: 20 })
    const hasNotChanged = cache.matchByValue('key', { temp: 25 })

    expect(hasNotChanged).toBe(false)
  })

  it('should generate consistent cache keys', () => {
    const cache = new Cache()
    const keys = cache.cacheKey('appliance-123')

    expect(keys.state).toBe('appliance-123:state')
    expect(keys.autoDiscovery).toBe('appliance-123:auto-discovery')
  })

  it('should handle value comparison with different types', () => {
    const cache = new Cache()

    // Test with object
    const obj = { type: 'object' }
    expect(cache.matchByValue('obj-key', obj)).toBe(false)
    expect(cache.matchByValue('obj-key', obj)).toBe(true)

    // Test with array
    const arr = [1, 2, 3]
    expect(cache.matchByValue('arr-key', arr)).toBe(false)
    expect(cache.matchByValue('arr-key', arr)).toBe(true)

    // Test with number
    const num = 123
    expect(cache.matchByValue('num-key', num)).toBe(false)
    expect(cache.matchByValue('num-key', num)).toBe(true)
  })

  describe('m5 — hash-based equality in matchByValue', () => {
    it('should treat structurally-equal but reference-different objects as a HIT', () => {
      const cache = new Cache()
      const first = { temp: 22, mode: 'cool' }
      const second = { temp: 22, mode: 'cool' } // different reference, same content

      expect(cache.matchByValue('key', first)).toBe(false) // MISS: new key
      expect(cache.matchByValue('key', second)).toBe(true) // HIT: same content
    })

    it('should treat objects with a single changed field as a MISS', () => {
      const cache = new Cache()
      cache.matchByValue('key', { temp: 22 })

      expect(cache.matchByValue('key', { temp: 23 })).toBe(false)
    })

    it('should clear hash entry on delete', () => {
      const cache = new Cache()
      cache.matchByValue('key', { a: 1 })

      cache.delete('key')

      // After delete, same value must be treated as MISS again
      expect(cache.matchByValue('key', { a: 1 })).toBe(false)
    })
  })

  describe('lifetime', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('keeps entries until they are deleted — no TTL or size eviction', () => {
      vi.useFakeTimers()
      const cache = new Cache()
      cache.setState('appliance-1', state())
      cache.matchByValue('discovery', { modes: ['cool'] })
      for (let i = 0; i < 2000; i++) cache.matchByValue(`filler-${i}`, i)

      vi.advanceTimersByTime(25 * 60 * 60 * 1000) // past the old 24 h TTL

      expect(cache.getState('appliance-1')).toEqual(state())
      expect(cache.matchByValue('discovery', { modes: ['cool'] })).toBe(true)
    })
  })

  describe('m4 — capability-hashed autoDiscovery cache key', () => {
    it('should produce the legacy autoDiscovery key when no hash is provided', () => {
      const cache = new Cache()
      const keys = cache.cacheKey('appliance-xyz')

      expect(keys.autoDiscovery).toBe('appliance-xyz:auto-discovery')
    })

    it('should embed the capabilities hash in the autoDiscovery key', () => {
      const cache = new Cache()
      const keys = cache.cacheKey('appliance-xyz', 'abc123def456')

      expect(keys.autoDiscovery).toBe('appliance-xyz:auto-discovery:abc123def456')
      // State key must be unchanged regardless
      expect(keys.state).toBe('appliance-xyz:state')
    })

    it('should produce a MISS when capabilities hash changes', () => {
      const cache = new Cache()
      const config = { modes: ['cool', 'heat'], fans: ['auto', 'high'] }

      // Prime with hash A
      const keyA = cache.cacheKey('appliance-1', 'hashAAAAAAAAAAA').autoDiscovery
      expect(cache.matchByValue(keyA, config)).toBe(false) // MISS

      // Same config but with hash B — different key → MISS
      const keyB = cache.cacheKey('appliance-1', 'hashBBBBBBBBBBB').autoDiscovery
      expect(cache.matchByValue(keyB, config)).toBe(false) // MISS (different key)
    })

    it('should produce a HIT when capabilities hash and config are both unchanged', () => {
      const cache = new Cache()
      const config = { modes: ['cool', 'heat'] }
      const key = cache.cacheKey('appliance-1', 'stableHash12').autoDiscovery

      cache.matchByValue(key, config) // prime
      expect(cache.matchByValue(key, config)).toBe(true) // HIT
    })
  })

  describe('with skipCacheLogging disabled', () => {
    const loggerDebugSpy = vi.fn()

    afterEach(() => {
      vi.restoreAllMocks()
      vi.resetModules()
    })

    it('should log debug messages when skipCacheLogging is false', async () => {
      vi.resetModules()
      vi.doMock('#/config.ts', () => ({
        default: { logging: { skipCacheLogging: false } },
      }))
      vi.doMock('#/logger.ts', () => ({
        default: () => ({ debug: loggerDebugSpy, info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
      }))

      const { cache } = await import('#/cache.ts')

      cache.setState('appliance-1', { applianceId: 'appliance-1', mode: 'cool' } as NormalizedState)
      expect(loggerDebugSpy).toHaveBeenCalledWith(expect.stringContaining('Set "appliance-1:state"'), expect.anything())

      // matchByValue logs both the store and the unchanged hit
      loggerDebugSpy.mockClear()
      cache.matchByValue('test-key', { name: 'value' })
      cache.matchByValue('test-key', { name: 'value' })
      expect(loggerDebugSpy).toHaveBeenCalledWith(expect.stringContaining('has not changed'))
    })
  })
})

import { describe, expect, it } from 'vitest'
import { Cache } from '../src/cache'

describe('Cache', () => {
  it('should store and retrieve values', () => {
    const cache = new Cache<{ name: string }>()
    cache.set('test-key', { name: 'value' })
    const retrieved = cache.get('test-key')
    expect(retrieved).toEqual({ name: 'value' })
  })

  it('should return undefined for non-existent keys', () => {
    const cache = new Cache()
    expect(cache.get('non-existent')).toBeUndefined()
  })

  it('should detect when value has not changed', () => {
    const cache = new Cache<{ name: string }>()
    const value = { name: 'test' }

    // First call should return false (value changed/new)
    expect(cache.matchByValue('key', value)).toBe(false)

    // Second call with same value should return true (no change)
    expect(cache.matchByValue('key', value)).toBe(true)
  })

  it('should detect when value has changed', () => {
    const cache = new Cache<{ temp: number }>()

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

  it('should clear values', () => {
    const cache = new Cache<{ val: string }>()
    cache.set('key', { val: 'value' })
    expect(cache.get('key')).toEqual({ val: 'value' })

    cache.delete('key')
    expect(cache.get('key')).toBeUndefined()
  })

  it('should check if key exists', () => {
    const cache = new Cache<{ test: string }>()
    expect(cache.has('key')).toBe(false)

    cache.set('key', { test: 'value' })
    expect(cache.has('key')).toBe(true)

    cache.delete('key')
    expect(cache.has('key')).toBe(false)
  })

  it('should handle getting unparsed values', () => {
    const cache = new Cache<Record<string, unknown>>()
    cache.set('test-key', { data: 'value' })
    const unparsed = cache.get('test-key', false)
    expect(typeof unparsed).toBe('string')
  })

  it('should handle number values', () => {
    const cache = new Cache<{ count: number }>()
    cache.set('count-key', { count: 42 })
    expect(cache.get('count-key')).toEqual({ count: 42 })
  })

  it('should handle array values', () => {
    const cache = new Cache<number[]>()
    cache.set('array-key', [1, 2, 3])
    expect(cache.get('array-key')).toEqual([1, 2, 3])
  })

  it('should handle nested objects', () => {
    const cache = new Cache<{ nested: { deep: { value: string } } }>()
    const nested = { nested: { deep: { value: 'test' } } }
    cache.set('nested-key', nested)
    expect(cache.get('nested-key')).toEqual(nested)
  })

  it('should return cache instance for chaining', () => {
    const cache = new Cache<{ val: string }>()
    const result = cache.set('key1', { val: 'value1' })
    expect(result).toBe(cache)

    // Should allow chaining
    cache.set('key2', { val: 'value2' }).set('key3', { val: 'value3' })
    expect(cache.has('key2')).toBe(true)
    expect(cache.has('key3')).toBe(true)
  })

  it('should handle value comparison with different types', () => {
    const cache = new Cache<unknown>()

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
})

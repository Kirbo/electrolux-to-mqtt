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
})

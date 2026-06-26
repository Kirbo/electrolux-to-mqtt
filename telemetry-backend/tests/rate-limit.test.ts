import { describe, expect, it, vi } from 'vitest'
import { createRateLimiter } from '../src/rate-limit.js'

describe('createRateLimiter', () => {
  it('allows the first request for a new IP', () => {
    const limiter = createRateLimiter(5, 60_000)
    expect(limiter.allow('1.1.1.1')).toBe(true)
  })

  it('allows requests up to the configured maximum', () => {
    const limiter = createRateLimiter(3, 60_000)
    expect(limiter.allow('1.1.1.1')).toBe(true)
    expect(limiter.allow('1.1.1.1')).toBe(true)
    expect(limiter.allow('1.1.1.1')).toBe(true)
  })

  it('denies the request that exceeds the maximum', () => {
    const limiter = createRateLimiter(3, 60_000)
    limiter.allow('1.1.1.1')
    limiter.allow('1.1.1.1')
    limiter.allow('1.1.1.1')
    expect(limiter.allow('1.1.1.1')).toBe(false)
  })

  it('tracks different IPs independently', () => {
    const limiter = createRateLimiter(1, 60_000)
    expect(limiter.allow('1.1.1.1')).toBe(true)
    expect(limiter.allow('2.2.2.2')).toBe(true)
    expect(limiter.allow('1.1.1.1')).toBe(false)
    expect(limiter.allow('2.2.2.2')).toBe(false)
  })

  it('resets the window after the configured time has elapsed', () => {
    const now = Date.now()
    vi.setSystemTime(now)

    const limiter = createRateLimiter(2, 1_000)
    expect(limiter.allow('1.1.1.1')).toBe(true)
    expect(limiter.allow('1.1.1.1')).toBe(true)
    expect(limiter.allow('1.1.1.1')).toBe(false)

    vi.setSystemTime(now + 1_001)
    expect(limiter.allow('1.1.1.1')).toBe(true)

    vi.useRealTimers()
  })

  it('continues denying within the same window after reset point has not been reached', () => {
    const now = Date.now()
    vi.setSystemTime(now)

    const limiter = createRateLimiter(2, 5_000)
    limiter.allow('1.1.1.1')
    limiter.allow('1.1.1.1')

    vi.setSystemTime(now + 4_999)
    expect(limiter.allow('1.1.1.1')).toBe(false)

    vi.useRealTimers()
  })
})

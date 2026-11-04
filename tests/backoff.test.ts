import { afterEach, describe, expect, it, vi } from 'vitest'
import { computeBackoffDelay } from '#/backoff.ts'

describe('computeBackoffDelay', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('doubles per attempt, with jitter in the upper half of the delay', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(computeBackoffDelay(0, 5_000, 300_000)).toBe(2_500)
    expect(computeBackoffDelay(2, 5_000, 300_000)).toBe(10_000)

    vi.spyOn(Math, 'random').mockReturnValue(0.999_999)
    expect(computeBackoffDelay(0, 5_000, 300_000)).toBeCloseTo(5_000, 0)
  })

  it('caps the delay at maxMs however many attempts failed', () => {
    // Uncapped, attempt 20 would be 5000 * 2^20 ms (~58 days).
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(computeBackoffDelay(20, 5_000, 300_000)).toBe(150_000)
    vi.spyOn(Math, 'random').mockReturnValue(0.999_999)
    expect(computeBackoffDelay(20, 5_000, 300_000)).toBeLessThanOrEqual(300_000)
  })
})

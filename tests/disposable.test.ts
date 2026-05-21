import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { disposableInterval, disposableTimeout } from '@/disposable.js'

describe('disposable helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('disposableTimeout', () => {
    it('should fire the callback after the given delay', () => {
      const fn = vi.fn()
      disposableTimeout(fn, 500)

      expect(fn).not.toHaveBeenCalled()
      vi.advanceTimersByTime(500)
      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should cancel the timeout when disposed before it fires', () => {
      const fn = vi.fn()
      const d = disposableTimeout(fn, 1000)

      d[Symbol.dispose]()
      vi.advanceTimersByTime(2000)

      expect(fn).not.toHaveBeenCalled()
    })

    it('should be safe to dispose after the timeout has already fired', () => {
      const fn = vi.fn()
      const d = disposableTimeout(fn, 100)

      vi.advanceTimersByTime(100)
      expect(fn).toHaveBeenCalledTimes(1)

      // Dispose after firing must not throw
      expect(() => d[Symbol.dispose]()).not.toThrow()
    })

    it('should be usable with the using keyword', () => {
      const fn = vi.fn()
      {
        using _d = disposableTimeout(fn, 1000)
        // Block exits here — dispose fires, cancelling the timeout
      }
      vi.advanceTimersByTime(2000)
      expect(fn).not.toHaveBeenCalled()
    })
  })

  describe('disposableInterval', () => {
    it('should fire the callback repeatedly at the given interval', () => {
      const fn = vi.fn()
      const d = disposableInterval(fn, 300)

      vi.advanceTimersByTime(900)
      expect(fn).toHaveBeenCalledTimes(3)

      d[Symbol.dispose]()
    })

    it('should stop firing after being disposed', () => {
      const fn = vi.fn()
      const d = disposableInterval(fn, 500)

      vi.advanceTimersByTime(500)
      expect(fn).toHaveBeenCalledTimes(1)

      d[Symbol.dispose]()
      vi.advanceTimersByTime(1000)

      expect(fn).toHaveBeenCalledTimes(1)
    })

    it('should be safe to dispose multiple times', () => {
      const fn = vi.fn()
      const d = disposableInterval(fn, 1000)

      d[Symbol.dispose]()
      expect(() => d[Symbol.dispose]()).not.toThrow()

      vi.advanceTimersByTime(2000)
      expect(fn).not.toHaveBeenCalled()
    })

    it('should be usable with the using keyword', () => {
      const fn = vi.fn()
      {
        using _d = disposableInterval(fn, 500)
        vi.advanceTimersByTime(500)
        expect(fn).toHaveBeenCalledTimes(1)
        // Block exits — interval is cleared
      }
      vi.advanceTimersByTime(1000)
      expect(fn).toHaveBeenCalledTimes(1)
    })
  })
})

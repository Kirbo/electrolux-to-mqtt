type WindowState = { count: number; windowStart: number }

export interface RateLimiter {
  allow(ip: string): boolean
  /** Number of currently tracked IPs — for observability and tests. */
  size(): number
}

/**
 * Fixed-window per-IP rate limiter.
 *
 * Each IP gets `maxRequests` tokens per `windowMs` milliseconds. The window
 * resets on the first request after the window expires — not on a fixed clock
 * boundary — which is intentional: it simplifies state and is sufficient for
 * abuse protection on a low-traffic telemetry endpoint.
 *
 * Expired entries are pruned at most once per window (amortized O(n)) so the
 * tracked-IP map cannot grow unbounded under IP churn or an IP-spray.
 */
export function createRateLimiter(maxRequests: number, windowMs: number): RateLimiter {
  const windows = new Map<string, WindowState>()
  let lastSweep = Date.now()

  function sweepExpired(now: number): void {
    for (const [ip, state] of windows) {
      if (now - state.windowStart >= windowMs) windows.delete(ip)
    }
    lastSweep = now
  }

  return {
    allow(ip: string): boolean {
      const now = Date.now()
      if (now - lastSweep >= windowMs) sweepExpired(now)

      const state = windows.get(ip)

      if (!state || now - state.windowStart >= windowMs) {
        windows.set(ip, { count: 1, windowStart: now })
        return true
      }

      if (state.count >= maxRequests) {
        return false
      }

      state.count++
      return true
    },
    size(): number {
      return windows.size
    },
  }
}

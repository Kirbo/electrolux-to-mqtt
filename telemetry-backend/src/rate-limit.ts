type WindowState = { count: number; windowStart: number }

export interface RateLimiter {
  allow(ip: string): boolean
}

/**
 * Fixed-window per-IP rate limiter.
 *
 * Each IP gets `maxRequests` tokens per `windowMs` milliseconds. The window
 * resets on the first request after the window expires — not on a fixed clock
 * boundary — which is intentional: it simplifies state and is sufficient for
 * abuse protection on a low-traffic telemetry endpoint.
 */
export function createRateLimiter(maxRequests: number, windowMs: number): RateLimiter {
  const windows = new Map<string, WindowState>()

  return {
    allow(ip: string): boolean {
      const now = Date.now()
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
  }
}

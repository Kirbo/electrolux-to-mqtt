import type http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AptabaseEvent, AptabaseForwarder } from '../src/aptabase.js'
import type { BadgeStore } from '../src/badge-store.js'
import type { RateLimiter } from '../src/rate-limit.js'
import { createServer } from '../src/server.js'

// ── Test doubles ─────────────────────────────────────────────────────────────

class FakeBadgeStore implements BadgeStore {
  private _usersSvg: string | null = null
  private _stableSvg: string | null = null
  private _betaSvg: string | null = null
  private _telemetryJson: string | null = null

  setUsersSvg(v: string | null): void {
    this._usersSvg = v
  }
  setStableSvg(v: string | null): void {
    this._stableSvg = v
  }
  setBetaSvg(v: string | null): void {
    this._betaSvg = v
  }
  setTelemetryJson(v: string | null): void {
    this._telemetryJson = v
  }

  getUsersSvg(): string | null {
    return this._usersSvg
  }
  getStableSvg(): string | null {
    return this._stableSvg
  }
  getBetaSvg(): string | null {
    return this._betaSvg
  }
  getTelemetryJson(): string | null {
    return this._telemetryJson
  }
  async regenerate(): Promise<void> {
    /* no-op */
  }
}

class FakeForwarder implements AptabaseForwarder {
  readonly calls: Array<{ event: AptabaseEvent; clientIp: string }> = []
  private shouldThrow = false

  setThrows(value: boolean): void {
    this.shouldThrow = value
  }

  async forward(event: AptabaseEvent, clientIp: string): Promise<void> {
    if (this.shouldThrow) throw new Error('Aptabase unreachable')
    this.calls.push({ event, clientIp })
  }
}

class FakeRateLimiter implements RateLimiter {
  private _allow = true

  setAllow(value: boolean): void {
    this._allow = value
  }
  allow(_ip: string): boolean {
    return this._allow
  }
  size(): number {
    return 0
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function startTestServer(
  store: BadgeStore,
  forwarder: AptabaseForwarder,
  limiter: RateLimiter,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(store, forwarder, limiter, '1.0.0')
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'))
        return
      }
      resolve({ server, port: addr.port })
    })
    server.on('error', reject)
  })
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

async function get(port: number, path: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`)
}

async function post(port: number, path: string, body: unknown, contentType = 'application/json'): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: JSON.stringify(body),
  })
}

const VALID_HASH = 'a'.repeat(64)
const VALID_BODY = { userHash: VALID_HASH, version: '1.2.3', channel: 'stable' }
const SAMPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20"></svg>'
const SAMPLE_JSON = JSON.stringify({ total: 42, channels: { stable: 42, beta: 0 }, versions: [] })

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createServer', () => {
  let server: http.Server
  let port: number
  let store: FakeBadgeStore
  let forwarder: FakeForwarder
  let limiter: FakeRateLimiter

  beforeEach(async () => {
    store = new FakeBadgeStore()
    forwarder = new FakeForwarder()
    limiter = new FakeRateLimiter()
    const result = await startTestServer(store, forwarder, limiter)
    server = result.server
    port = result.port
  })

  afterEach(async () => {
    await stopServer(server)
  })

  // ── Health ────────────────────────────────────────────────────────────────

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await get(port, '/health')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string }
      expect(body.status).toBe('ok')
    })
  })

  // ── Root redirect ─────────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 302 redirect to /users.svg', async () => {
      // fetch follows redirects by default; use redirect:'manual' to catch it
      const res = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/users.svg')
    })
  })

  // ── Badge routes — populated ──────────────────────────────────────────────

  describe('GET /users.svg — store populated', () => {
    it('returns 200 with SVG content-type', async () => {
      store.setUsersSvg(SAMPLE_SVG)
      const res = await get(port, '/users.svg')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('image/svg+xml')
    })

    it('returns no-cache headers', async () => {
      store.setUsersSvg(SAMPLE_SVG)
      const res = await get(port, '/users.svg')
      expect(res.headers.get('cache-control')).toContain('no-cache')
    })

    it('returns the SVG body', async () => {
      store.setUsersSvg(SAMPLE_SVG)
      const text = await (await get(port, '/users.svg')).text()
      expect(text).toBe(SAMPLE_SVG)
    })
  })

  describe('GET /stable.svg — store populated', () => {
    it('returns 200 SVG', async () => {
      store.setStableSvg(SAMPLE_SVG)
      const res = await get(port, '/stable.svg')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('image/svg+xml')
    })
  })

  describe('GET /beta.svg — store populated', () => {
    it('returns 200 SVG', async () => {
      store.setBetaSvg(SAMPLE_SVG)
      const res = await get(port, '/beta.svg')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('image/svg+xml')
    })
  })

  describe('GET /telemetry.json — store populated', () => {
    it('returns 200 with JSON content-type', async () => {
      store.setTelemetryJson(SAMPLE_JSON)
      const res = await get(port, '/telemetry.json')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('returns no-cache headers', async () => {
      store.setTelemetryJson(SAMPLE_JSON)
      const res = await get(port, '/telemetry.json')
      expect(res.headers.get('cache-control')).toContain('no-cache')
    })

    it('returns the JSON body', async () => {
      store.setTelemetryJson(SAMPLE_JSON)
      const text = await (await get(port, '/telemetry.json')).text()
      expect(text).toBe(SAMPLE_JSON)
    })
  })

  // ── Badge routes — not yet ready ──────────────────────────────────────────

  describe('badge routes — null store (not yet ready)', () => {
    it('GET /users.svg returns 503', async () => {
      const res = await get(port, '/users.svg')
      expect(res.status).toBe(503)
    })

    it('GET /stable.svg returns 503', async () => {
      const res = await get(port, '/stable.svg')
      expect(res.status).toBe(503)
    })

    it('GET /beta.svg returns 503', async () => {
      const res = await get(port, '/beta.svg')
      expect(res.status).toBe(503)
    })

    it('GET /telemetry.json returns 503', async () => {
      const res = await get(port, '/telemetry.json')
      expect(res.status).toBe(503)
    })
  })

  // ── POST /telemetry — happy path ──────────────────────────────────────────

  describe('POST /telemetry — happy path', () => {
    it('returns 204 for a valid body', async () => {
      const res = await post(port, '/telemetry', VALID_BODY)
      expect(res.status).toBe(204)
    })

    it('calls the forwarder with the translated event', async () => {
      await post(port, '/telemetry', VALID_BODY)
      expect(forwarder.calls).toHaveLength(1)
      const call = forwarder.calls[0]
      expect(call?.event.eventName).toBe('version_check')
      expect(call?.event.sessionId).toBe(VALID_HASH)
      expect(call?.event.props.source).toBe('legacy')
    })

    it('sdkVersion is prefixed with telemetry-backend@', async () => {
      await post(port, '/telemetry', VALID_BODY)
      expect(forwarder.calls[0]?.event.systemProps.sdkVersion).toMatch(/^telemetry-backend@/)
    })

    it('accepts a body without channel', async () => {
      const res = await post(port, '/telemetry', { userHash: VALID_HASH, version: '1.2.3' })
      expect(res.status).toBe(204)
    })

    it('returns 204 even when the forwarder throws (best-effort)', async () => {
      forwarder.setThrows(true)
      const res = await post(port, '/telemetry', VALID_BODY)
      expect(res.status).toBe(204)
    })
  })

  // ── POST /telemetry — error handling ─────────────────────────────────────

  describe('POST /telemetry — error handling', () => {
    it('returns 400 for invalid JSON', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json {{{',
      })
      expect(res.status).toBe(400)
    })

    it('returns 400 for a body that fails validation', async () => {
      const res = await post(port, '/telemetry', { userHash: 'too-short', version: '1.2.3' })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).toBeTruthy()
    })

    it('returns 415 for non-JSON Content-Type', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'hello',
      })
      expect(res.status).toBe(415)
    })

    it('returns 413 for an oversized body and does not forward', async () => {
      const huge = 'x'.repeat(9 * 1024) // exceeds the 8 KB cap
      const res = await fetch(`http://127.0.0.1:${port}/telemetry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: huge,
      })
      expect(res.status).toBe(413)
      expect(forwarder.calls).toHaveLength(0)
    })
  })

  // ── Rate limiting ─────────────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('returns 429 when the rate limiter denies the request', async () => {
      limiter.setAllow(false)
      const res = await post(port, '/telemetry', VALID_BODY)
      expect(res.status).toBe(429)
    })

    it('does not call the forwarder when rate limited', async () => {
      limiter.setAllow(false)
      await post(port, '/telemetry', VALID_BODY)
      expect(forwarder.calls).toHaveLength(0)
    })

    it('applies the real rate limiter: allows up to limit then 429', async () => {
      const realLimiter = (await import('../src/rate-limit.js')).createRateLimiter(2, 60_000)
      const { server: s2, port: p2 } = await startTestServer(store, forwarder, realLimiter)
      try {
        const r1 = await post(p2, '/telemetry', VALID_BODY)
        const r2 = await post(p2, '/telemetry', VALID_BODY)
        const r3 = await post(p2, '/telemetry', VALID_BODY)
        expect(r1.status).toBe(204)
        expect(r2.status).toBe(204)
        expect(r3.status).toBe(429)
      } finally {
        await stopServer(s2)
      }
    })
  })

  // ── Method / routing ──────────────────────────────────────────────────────

  describe('method and path routing', () => {
    it('returns 405 for GET /telemetry', async () => {
      const res = await get(port, '/telemetry')
      expect(res.status).toBe(405)
    })

    it('returns 404 for unknown paths', async () => {
      const res = await get(port, '/unknown')
      expect(res.status).toBe(404)
    })

    it('returns 404 for POST to unknown path', async () => {
      const res = await post(port, '/unknown', VALID_BODY)
      expect(res.status).toBe(404)
    })
  })

  // ── X-Forwarded-For passthrough ───────────────────────────────────────────

  describe('X-Forwarded-For passthrough', () => {
    it('extracts the client IP from XFF and passes it to the forwarder', async () => {
      await fetch(`http://127.0.0.1:${port}/telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.42, 10.0.0.1',
        },
        body: JSON.stringify(VALID_BODY),
      })
      expect(forwarder.calls[0]?.clientIp).toBe('203.0.113.42')
    })
  })

  // ── Forwarder error logging ───────────────────────────────────────────────

  describe('forwarder error logging', () => {
    it('logs a warning when the forwarder throws', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      forwarder.setThrows(true)
      await post(port, '/telemetry', VALID_BODY)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[telemetry-backend]'), expect.any(Error))
      consoleSpy.mockRestore()
    })
  })
})

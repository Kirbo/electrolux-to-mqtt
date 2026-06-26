import type http from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AptabaseEvent, AptabaseForwarder } from '../src/aptabase.js'
import type { BadgeStore } from '../src/badge-store.js'
import type { RateLimiter } from '../src/rate-limit.js'
import { createServer } from '../src/server.js'

// ── Test doubles ─────────────────────────────────────────────────────────────

class FakeBadgeStore implements BadgeStore {
  private _telemetryJson: string | null = null
  private _stableTag: string | null = null
  private _betaTag: string | null = null

  setTelemetryJson(v: string | null): void {
    this._telemetryJson = v
  }
  setStableTag(v: string | null): void {
    this._stableTag = v
  }
  setBetaTag(v: string | null): void {
    this._betaTag = v
  }

  getTelemetryJson(): string | null {
    return this._telemetryJson
  }
  getStableTag(): string | null {
    return this._stableTag
  }
  getBetaTag(): string | null {
    return this._betaTag
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

const RELEASES_PAGE = 'https://gitlab.example/electrolux-to-mqtt/-/releases'

function startTestServer(
  store: BadgeStore,
  forwarder: AptabaseForwarder,
  limiter: RateLimiter,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(store, forwarder, limiter, RELEASES_PAGE, '1.0.0')
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

  // ── GET /telemetry (JSON) ──────────────────────────────────────────────────

  describe('GET /telemetry', () => {
    it('returns 200 with the JSON when populated', async () => {
      store.setTelemetryJson(SAMPLE_JSON)
      const res = await get(port, '/telemetry')
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('application/json')
      expect(await res.text()).toBe(SAMPLE_JSON)
    })

    it('returns no-cache headers', async () => {
      store.setTelemetryJson(SAMPLE_JSON)
      const res = await get(port, '/telemetry')
      expect(res.headers.get('cache-control')).toContain('no-cache')
    })

    it('returns 503 when not yet ready', async () => {
      const res = await get(port, '/telemetry')
      expect(res.status).toBe(503)
    })
  })

  // ── GET /stable, /beta redirects ───────────────────────────────────────────

  describe('GET /stable', () => {
    it('302 to the release page with the tag', async () => {
      store.setStableTag('v2026.6.0')
      const res = await fetch(`http://127.0.0.1:${port}/stable`, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(`${RELEASES_PAGE}/v2026.6.0`)
    })

    it('302 to the releases page when there is no tag', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/stable`, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(RELEASES_PAGE)
    })
  })

  describe('GET /beta', () => {
    it('302 to the release page with the tag', async () => {
      store.setBetaTag('v2026.6.0b1')
      const res = await fetch(`http://127.0.0.1:${port}/beta`, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(`${RELEASES_PAGE}/v2026.6.0b1`)
    })

    it('302 to the releases page when there is no tag', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/beta`, { redirect: 'manual' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(RELEASES_PAGE)
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
      // userHash is mapped to a UUID-shaped sessionId (Aptabase drops non-GUID sessionIds).
      expect(call?.event.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
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

  // ── Unknown route ─────────────────────────────────────────────────────────

  describe('unknown route', () => {
    it('returns 404', async () => {
      const res = await get(port, '/nope')
      expect(res.status).toBe(404)
    })
  })
})

import crypto from 'node:crypto'
import type { Request } from 'express'
import { describe, expect, it } from 'vitest'
import { getClientIp, hashIp, validateTelemetryPayload } from '../src/utils.js'

// Build a minimal Express-like request for getClientIp tests. Includes socket
// (for direct TCP address), ip (Express-populated when trust proxy is on), and
// both proxy headers (X-Real-IP legacy, X-Forwarded-For standard).
function buildRequest({
  xRealIp,
  xForwardedFor,
  ip,
  remoteAddress,
}: {
  xRealIp?: string
  xForwardedFor?: string
  ip?: string
  remoteAddress?: string
}): Request {
  const headers: Record<string, string> = {}
  if (xRealIp !== undefined) headers['x-real-ip'] = xRealIp
  if (xForwardedFor !== undefined) headers['x-forwarded-for'] = xForwardedFor
  return {
    get(name: string) {
      return headers[name.toLowerCase()]
    },
    ip,
    socket: { remoteAddress },
  } as unknown as Request
}

describe('validateTelemetryPayload', () => {
  const validHash = 'a'.repeat(64)
  const validVersion = '1.2.3'

  it('returns null for a well-formed payload', () => {
    expect(validateTelemetryPayload(validHash, validVersion)).toBeNull()
  })

  it('rejects mixed-case hex userHash (Node digest("hex") is always lowercase)', () => {
    expect(validateTelemetryPayload('AbCdEf0123456789'.repeat(4), validVersion)).toMatch(/must be hex/)
  })

  it('accepts common semver-ish version forms', () => {
    for (const v of ['1.0.0', 'v1.2.3', '1.0.0-rc.1', '2.3.4-beta.1', '0.1.0']) {
      expect(validateTelemetryPayload(validHash, v)).toBeNull()
    }
  })

  it('rejects non-semver version forms', () => {
    // Underscore separators, dot-only, missing patch segment
    expect(validateTelemetryPayload(validHash, '2.3.4_beta')).toMatch(/invalid characters/)
    expect(validateTelemetryPayload(validHash, '0.1')).toMatch(/invalid characters/)
  })

  it('rejects non-string userHash', () => {
    expect(validateTelemetryPayload(123, validVersion)).toMatch(/must be strings/)
    expect(validateTelemetryPayload(null, validVersion)).toMatch(/must be strings/)
    expect(validateTelemetryPayload(undefined, validVersion)).toMatch(/must be strings/)
  })

  it('rejects non-string version', () => {
    expect(validateTelemetryPayload(validHash, 123)).toMatch(/must be strings/)
  })

  it('rejects userHash shorter than 64 chars', () => {
    expect(validateTelemetryPayload('a'.repeat(63), validVersion)).toMatch(/length is invalid/)
  })

  it('rejects userHash longer than 64 chars', () => {
    expect(validateTelemetryPayload('a'.repeat(65), validVersion)).toMatch(/length is invalid/)
  })

  it('rejects non-hex userHash', () => {
    // Exactly 64 chars but with a non-hex character — must hit hex check, not length check
    expect(validateTelemetryPayload(`${'a'.repeat(63)}z`, validVersion)).toMatch(/must be hex/)
  })

  it('rejects empty version', () => {
    expect(validateTelemetryPayload(validHash, '')).toMatch(/length is invalid/)
  })

  it('rejects version longer than 32 chars', () => {
    expect(validateTelemetryPayload(validHash, 'x'.repeat(33))).toMatch(/length is invalid/)
  })

  it('rejects version with invalid characters', () => {
    expect(validateTelemetryPayload(validHash, '1.0.0 beta')).toMatch(/invalid characters/)
    expect(validateTelemetryPayload(validHash, '1.0.0;rm -rf')).toMatch(/invalid characters/)
  })
})

describe('hashIp', () => {
  it('is deterministic for the same input and salt', () => {
    expect(hashIp('1.2.3.4', 'salt')).toBe(hashIp('1.2.3.4', 'salt'))
  })

  it('differs when the salt changes', () => {
    expect(hashIp('1.2.3.4', 'salt-a')).not.toBe(hashIp('1.2.3.4', 'salt-b'))
  })

  it('differs when the IP changes', () => {
    expect(hashIp('1.2.3.4', 'salt')).not.toBe(hashIp('5.6.7.8', 'salt'))
  })

  it('produces a 64-char lowercase hex digest (HMAC-SHA-256)', () => {
    const hash = hashIp('1.2.3.4', 'salt')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('matches a manually computed HMAC-SHA-256 reference', () => {
    const expected = crypto.createHmac('sha256', 'salt').update('1.2.3.4').digest('hex')
    expect(hashIp('1.2.3.4', 'salt')).toBe(expected)
  })
})

describe('getClientIp', () => {
  // ── behindProxy = false (direct exposure, default) ──────────────────────
  describe('behindProxy = false', () => {
    it('returns socket.remoteAddress regardless of X-Real-IP', () => {
      const req = buildRequest({ xRealIp: '10.0.0.1', remoteAddress: '203.0.113.5' })
      expect(getClientIp(req, false)).toBe('203.0.113.5')
    })

    it('returns socket.remoteAddress regardless of X-Forwarded-For', () => {
      const req = buildRequest({ xForwardedFor: '1.2.3.4', remoteAddress: '203.0.113.5' })
      expect(getClientIp(req, false)).toBe('203.0.113.5')
    })

    it('returns "unknown" when socket.remoteAddress is undefined', () => {
      const req = buildRequest({ xRealIp: '10.0.0.1' })
      expect(getClientIp(req, false)).toBe('unknown')
    })
  })

  // ── behindProxy = true (trusted reverse proxy present) ──────────────────
  describe('behindProxy = true', () => {
    it('prefers req.ip (Express X-Forwarded-For resolution) over X-Real-IP', () => {
      // Express sets req.ip from X-Forwarded-For when trust proxy is on
      const req = buildRequest({ xRealIp: '10.0.0.1', ip: '192.168.1.50', remoteAddress: '127.0.0.1' })
      expect(getClientIp(req, true)).toBe('192.168.1.50')
    })

    it('falls back to X-Real-IP when req.ip is absent', () => {
      const req = buildRequest({ xRealIp: '10.0.0.1', remoteAddress: '127.0.0.1' })
      expect(getClientIp(req, true)).toBe('10.0.0.1')
    })

    it('falls back to socket.remoteAddress when neither req.ip nor X-Real-IP is present', () => {
      const req = buildRequest({ remoteAddress: '127.0.0.1' })
      expect(getClientIp(req, true)).toBe('127.0.0.1')
    })

    it('returns "unknown" when all sources are absent', () => {
      const req = buildRequest({})
      expect(getClientIp(req, true)).toBe('unknown')
    })
  })
})

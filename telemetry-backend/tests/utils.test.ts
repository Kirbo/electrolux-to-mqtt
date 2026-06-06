import crypto from 'node:crypto'
import type { Request } from 'express'
import { describe, expect, it } from 'vitest'
import { getClientIp, hashIp, isPreReleaseVersion, validateTelemetryPayload } from '../src/utils.js'

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

  it('accepts CalVer stable form 2026.6.0', () => {
    expect(validateTelemetryPayload(validHash, '2026.6.0')).toBeNull()
  })

  it('accepts CalVer beta form 2026.6.0b1', () => {
    expect(validateTelemetryPayload(validHash, '2026.6.0b1')).toBeNull()
  })

  it('accepts CalVer beta form with v prefix v2026.6.0b1', () => {
    expect(validateTelemetryPayload(validHash, 'v2026.6.0b1')).toBeNull()
  })

  it('accepts CalVer stable with v prefix v2026.6.0', () => {
    expect(validateTelemetryPayload(validHash, 'v2026.6.0')).toBeNull()
  })

  it('rejects junk version forms', () => {
    expect(validateTelemetryPayload(validHash, 'not-a-version')).toMatch(/invalid characters/)
    expect(validateTelemetryPayload(validHash, '2026.6.0b')).toMatch(/invalid characters/)
    expect(validateTelemetryPayload(validHash, '2026.6.0b-1')).toMatch(/invalid characters/)
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

  it('accepts valid channel "stable"', () => {
    expect(validateTelemetryPayload(validHash, validVersion, 'stable')).toBeNull()
  })

  it('accepts valid channel "beta"', () => {
    expect(validateTelemetryPayload(validHash, validVersion, 'beta')).toBeNull()
  })

  it('accepts missing channel (legacy clients)', () => {
    expect(validateTelemetryPayload(validHash, validVersion, undefined)).toBeNull()
  })

  it('rejects junk channel "nightly"', () => {
    expect(validateTelemetryPayload(validHash, validVersion, 'nightly')).toMatch(/channel/)
  })

  it('rejects non-string channel (number)', () => {
    expect(validateTelemetryPayload(validHash, validVersion, 123 as unknown as string)).toMatch(/channel/)
  })
})

describe('isPreReleaseVersion', () => {
  it('returns true for CalVer beta form 2026.6.5b1', () => {
    expect(isPreReleaseVersion('2026.6.5b1')).toBe(true)
  })

  it('returns true for SemVer dash form 1.18.5-rc.4', () => {
    expect(isPreReleaseVersion('1.18.5-rc.4')).toBe(true)
  })

  it('returns false for stable CalVer 2026.6.0', () => {
    expect(isPreReleaseVersion('2026.6.0')).toBe(false)
  })

  it('returns false for stable SemVer 1.18.4', () => {
    expect(isPreReleaseVersion('1.18.4')).toBe(false)
  })

  it('returns true for v-prefixed beta v2026.6.0b1', () => {
    expect(isPreReleaseVersion('v2026.6.0b1')).toBe(true)
  })

  it('returns true for v-prefixed dash form v1.18.5-rc.1', () => {
    expect(isPreReleaseVersion('v1.18.5-rc.1')).toBe(true)
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

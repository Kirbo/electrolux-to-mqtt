import crypto from 'node:crypto'
import type { Request } from 'express'
import { describe, expect, it } from 'vitest'
import { getClientIp, hashIp, validateTelemetryPayload } from '../src/utils.js'

// Build a minimal Express-like request for getClientIp tests. Only the two
// methods the function reads are implemented.
function buildRequest({ xRealIp, ip }: { xRealIp?: string; ip?: string }): Request {
  const headers: Record<string, string> = {}
  if (xRealIp !== undefined) headers['x-real-ip'] = xRealIp
  return {
    get(name: string) {
      return headers[name.toLowerCase()]
    },
    ip,
  } as unknown as Request
}

describe('validateTelemetryPayload', () => {
  const validHash = 'a'.repeat(64)
  const validVersion = '1.2.3'

  it('returns null for a well-formed payload', () => {
    expect(validateTelemetryPayload(validHash, validVersion)).toBeNull()
  })

  it('accepts mixed-case hex userHash', () => {
    expect(validateTelemetryPayload('AbCdEf0123456789'.repeat(4), validVersion)).toBeNull()
  })

  it('accepts common semver-ish version forms', () => {
    for (const v of ['1.0.0', 'v1.2.3', '1.0.0-rc.1', '2.3.4_beta', '0.1']) {
      expect(validateTelemetryPayload(validHash, v)).toBeNull()
    }
  })

  it('rejects non-string userHash', () => {
    expect(validateTelemetryPayload(123, validVersion)).toMatch(/must be strings/)
    expect(validateTelemetryPayload(null, validVersion)).toMatch(/must be strings/)
    expect(validateTelemetryPayload(undefined, validVersion)).toMatch(/must be strings/)
  })

  it('rejects non-string version', () => {
    expect(validateTelemetryPayload(validHash, 123)).toMatch(/must be strings/)
  })

  it('rejects userHash shorter than 32 chars', () => {
    expect(validateTelemetryPayload('a'.repeat(31), validVersion)).toMatch(/length is invalid/)
  })

  it('rejects userHash longer than 128 chars', () => {
    expect(validateTelemetryPayload('a'.repeat(129), validVersion)).toMatch(/length is invalid/)
  })

  it('rejects non-hex userHash', () => {
    expect(validateTelemetryPayload(`${'a'.repeat(31)}z`, validVersion)).toMatch(/must be hex/)
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
  it('prefers X-Real-IP over req.ip', () => {
    const req = buildRequest({ xRealIp: '10.0.0.1', ip: '127.0.0.1' })
    expect(getClientIp(req)).toBe('10.0.0.1')
  })

  it('falls back to req.ip when X-Real-IP is missing', () => {
    const req = buildRequest({ ip: '127.0.0.1' })
    expect(getClientIp(req)).toBe('127.0.0.1')
  })

  it('returns "unknown" when neither header nor req.ip is present', () => {
    const req = buildRequest({})
    expect(getClientIp(req)).toBe('unknown')
  })
})

import { describe, expect, it } from 'vitest'
import { extractClientIp } from '../src/ip.js'

describe('extractClientIp', () => {
  it('prefers X-Real-IP (nginx-set, single value) over X-Forwarded-For', () => {
    // The first XFF element is client-supplied even behind nginx
    // ($proxy_add_x_forwarded_for APPENDS the real address) — trusting it
    // lets an attacker rotate limiter keys and bypass the rate limit.
    const headers = { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '203.0.113.7' }
    expect(extractClientIp(headers, '127.0.0.1')).toBe('203.0.113.7')
  })

  it('uses the LAST hop from X-Forwarded-For when X-Real-IP is absent', () => {
    // The last element is the one appended by the nearest (trusted) proxy.
    const headers = { 'x-forwarded-for': '6.6.6.6, 5.6.7.8, 203.0.113.9' }
    expect(extractClientIp(headers, '127.0.0.1')).toBe('203.0.113.9')
  })

  it('trims spaces around the selected XFF hop', () => {
    const headers = { 'x-forwarded-for': '1.2.3.4,  203.0.113.9  ' }
    expect(extractClientIp(headers, '127.0.0.1')).toBe('203.0.113.9')
  })

  it('uses X-Real-IP when X-Forwarded-For is absent', () => {
    const headers = { 'x-real-ip': '10.0.0.1' }
    expect(extractClientIp(headers, '127.0.0.1')).toBe('10.0.0.1')
  })

  it('falls back to socket address when neither header is present', () => {
    expect(extractClientIp({}, '203.0.113.5')).toBe('203.0.113.5')
  })

  it('falls back to unknown when socket address is also absent', () => {
    expect(extractClientIp({})).toBe('unknown')
  })

  it('handles a single-hop X-Forwarded-For (no comma)', () => {
    const headers = { 'x-forwarded-for': '8.8.8.8' }
    expect(extractClientIp(headers, '127.0.0.1')).toBe('8.8.8.8')
  })

  it('handles array-valued headers', () => {
    const headers = { 'x-real-ip': ['10.0.0.2'] }
    expect(extractClientIp(headers, '127.0.0.1')).toBe('10.0.0.2')
  })
})

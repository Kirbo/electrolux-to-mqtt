import { describe, expect, it } from 'vitest'
import { extractClientIp } from '../src/ip.js'

describe('extractClientIp', () => {
  it('uses the first hop from X-Forwarded-For', () => {
    const headers = { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' }
    expect(extractClientIp(headers, '127.0.0.1')).toBe('1.2.3.4')
  })

  it('trims spaces around the first XFF hop', () => {
    const headers = { 'x-forwarded-for': '  1.2.3.4  , 5.6.7.8' }
    expect(extractClientIp(headers, '127.0.0.1')).toBe('1.2.3.4')
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

  it('prefers X-Forwarded-For over X-Real-IP', () => {
    const headers = { 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '9.9.9.9' }
    expect(extractClientIp(headers, '127.0.0.1')).toBe('1.2.3.4')
  })

  it('handles a single-hop X-Forwarded-For (no comma)', () => {
    const headers = { 'x-forwarded-for': '8.8.8.8' }
    expect(extractClientIp(headers, '127.0.0.1')).toBe('8.8.8.8')
  })
})

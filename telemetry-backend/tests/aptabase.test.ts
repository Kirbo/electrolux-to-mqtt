import { describe, expect, it } from 'vitest'
import { buildAptabaseEvent, createHttpForwarder } from '../src/aptabase.js'

const VALID_HASH = 'a'.repeat(64)
const SERVICE_VERSION = '1.0.0'

const SAMPLE_EVENT = buildAptabaseEvent({ userHash: VALID_HASH, version: '2026.6.10', channel: 'stable' }, '1.0.0')

describe('buildAptabaseEvent', () => {
  it('maps the userHash to a UUID-shaped sessionId (Aptabase drops non-GUID sessionIds)', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('derives the sessionId deterministically from the userHash', () => {
    const a = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    const b = buildAptabaseEvent({ userHash: VALID_HASH, version: '9.9.9' }, SERVICE_VERSION)
    expect(a.sessionId).toBe(b.sessionId)
  })

  it('builds the sessionId from the first 16 bytes of the userHash', () => {
    const userHash = `0123456789abcdef${'f'.repeat(48)}`
    const event = buildAptabaseEvent({ userHash, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.sessionId).toBe('01234567-89ab-cdef-ffff-ffffffffffff')
  })

  it('sets eventName to version_check', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.eventName).toBe('version_check')
  })

  it('strips the leading v from the version for appVersion', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: 'v1.2.3' }, SERVICE_VERSION)
    expect(event.systemProps.appVersion).toBe('1.2.3')
  })

  it('leaves version without leading v unchanged', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '2026.6.0' }, SERVICE_VERSION)
    expect(event.systemProps.appVersion).toBe('2026.6.0')
  })

  it('sets isDebug to false', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.systemProps.isDebug).toBe(false)
  })

  it('sets sdkVersion to telemetry-backend@<version>', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.systemProps.sdkVersion).toBe(`telemetry-backend@${SERVICE_VERSION}`)
  })

  it('uses the channel from the body when present', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3', channel: 'beta' }, SERVICE_VERSION)
    expect(event.props.channel).toBe('beta')
  })

  it('derives channel=beta for a CalVer beta version when channel is absent', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '2026.6.0b1' }, SERVICE_VERSION)
    expect(event.props.channel).toBe('beta')
  })

  it('derives channel=beta for a semver pre-release version when channel is absent', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3-rc.1' }, SERVICE_VERSION)
    expect(event.props.channel).toBe('beta')
  })

  it('derives channel=stable for a stable version when channel is absent', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.props.channel).toBe('stable')
  })

  it('derives channel=stable for a CalVer stable version when channel is absent', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '2026.6.0' }, SERVICE_VERSION)
    expect(event.props.channel).toBe('stable')
  })

  it("sets source to 'legacy'", () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(event.props.source).toBe('legacy')
  })

  it('sets a valid ISO 8601 timestamp', () => {
    const event = buildAptabaseEvent({ userHash: VALID_HASH, version: '1.2.3' }, SERVICE_VERSION)
    expect(() => new Date(event.timestamp)).not.toThrow()
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp)
  })
})

describe('createHttpForwarder', () => {
  type FetchCall = { url: string; init: RequestInit }

  function fakeFetch(response: Response): { fetch: typeof fetch; calls: FetchCall[] } {
    const calls: FetchCall[] = []
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      calls.push({ url: String(input), init: init ?? {} })
      return response
    }) as typeof fetch
    return { fetch: fetchImpl, calls }
  }

  it('POSTs the event batch to the /api/v0/events endpoint with the App-Key', async () => {
    const { fetch, calls } = fakeFetch(new Response(null, { status: 200 }))
    const forwarder = createHttpForwarder('https://aptabase.example', 'A-KEY', fetch)

    await forwarder.forward(SAMPLE_EVENT, '203.0.113.7')

    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.url).toBe('https://aptabase.example/api/v0/events')
    expect(call?.init.method).toBe('POST')
    const headers = new Headers(call?.init.headers)
    expect(headers.get('App-Key')).toBe('A-KEY')
    expect(headers.get('X-Forwarded-For')).toBe('203.0.113.7')
    expect(call?.init.body).toBe(JSON.stringify([SAMPLE_EVENT]))
  })

  it('embeds the sessionId in the User-Agent so each install gets its own Aptabase user_id', async () => {
    const { fetch, calls } = fakeFetch(new Response(null, { status: 200 }))
    const forwarder = createHttpForwarder('https://aptabase.example', 'A-KEY', fetch)

    await forwarder.forward(SAMPLE_EVENT, '203.0.113.7')

    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get('User-Agent')).toBe(`electrolux-to-mqtt-legacy/${SAMPLE_EVENT.sessionId}`)
  })

  it('resolves on a 2xx response', async () => {
    const { fetch } = fakeFetch(new Response('{}', { status: 200 }))
    const forwarder = createHttpForwarder('https://aptabase.example', 'A-KEY', fetch)
    await expect(forwarder.forward(SAMPLE_EVENT, '203.0.113.7')).resolves.toBeUndefined()
  })

  it('throws with the status and body on a non-2xx response', async () => {
    const { fetch } = fakeFetch(new Response('bad app key', { status: 401, statusText: 'Unauthorized' }))
    const forwarder = createHttpForwarder('https://aptabase.example', 'A-KEY', fetch)
    await expect(forwarder.forward(SAMPLE_EVENT, '203.0.113.7')).rejects.toThrow(/401 Unauthorized: bad app key/)
  })
})

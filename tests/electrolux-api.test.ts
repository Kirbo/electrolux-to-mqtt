import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { ElectroluxApi } from '#/electrolux-api.js'
import {
  mockApplianceInfoResponse,
  mockApplianceStateResponse,
  mockAppliancesResponse,
} from './fixtures/api-responses.js'

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
vi.mock('#/logger.js', () => ({ default: () => log }))

const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)

const BASE = 'https://api.developer.electrolux.one'
const SETTINGS = { apiKey: 'api-key', timeoutMs: 25_000, refreshIntervalSeconds: 30, discoveryIntervalSeconds: 300 }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let auth: {
  isLoggedIn: boolean
  getAccessToken: Mock<() => Promise<string>>
  forceRefresh: Mock<() => Promise<void>>
}
let api: ElectroluxApi

beforeEach(() => {
  auth = {
    isLoggedIn: true,
    getAccessToken: vi.fn<() => Promise<string>>().mockResolvedValue('token-1'),
    forceRefresh: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }
  api = new ElectroluxApi(auth, SETTINGS)
  for (const fn of Object.values(log)) fn.mockClear()
})

afterEach(() => {
  fetchMock.mockReset()
})

const warnings = () => log.warn.mock.calls.map((c) => String(c[0]))

describe('requests', () => {
  it('sends the API key and bearer token to the API base URL with a timeout', async () => {
    fetchMock.mockResolvedValueOnce(json(mockAppliancesResponse))

    await api.getAppliances()

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE}/api/v1/appliances`)
    expect(init?.method).toBe('GET')
    expect(init?.headers).toMatchObject({ 'x-api-key': 'api-key', Authorization: 'Bearer token-1' })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    ['getAppliances', () => api.getAppliances(), '/api/v1/appliances', mockAppliancesResponse, mockAppliancesResponse],
    [
      'getApplianceInfo',
      () => api.getApplianceInfo('a-1'),
      '/api/v1/appliances/a-1/info',
      mockApplianceInfoResponse,
      mockApplianceInfoResponse,
    ],
    [
      'getApplianceState',
      () => api.getApplianceState('a-1'),
      '/api/v1/appliances/a-1/state',
      mockApplianceStateResponse,
      mockApplianceStateResponse,
    ],
  ])('%s returns the validated response', async (_name, call, path, body, expected) => {
    fetchMock.mockResolvedValueOnce(json(body))

    await expect(call()).resolves.toEqual(expected)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${BASE}${path}`)
  })

  it('sendCommand PUTs the payload and returns the response body', async () => {
    fetchMock.mockResolvedValueOnce(json({ status: 'OK' }))

    await expect(api.sendCommand('a-1', { executeCommand: 'ON' })).resolves.toEqual({ status: 'OK' })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`${BASE}/api/v1/appliances/a-1/command`)
    expect(init).toMatchObject({ method: 'PUT', body: '{"executeCommand":"ON"}' })
  })

  it.each([
    ['getAppliances', () => api.getAppliances(), [{ nope: 1 }], 'Error getting appliances'],
    ['getApplianceInfo', () => api.getApplianceInfo('a-1'), { nope: 1 }, 'Error getting appliance info'],
    ['getApplianceState', () => api.getApplianceState('a-1'), { nope: 1 }, 'Error getting appliance state'],
  ])('%s rejects a malformed response (undefined + logged)', async (_name, call, body, label) => {
    fetchMock.mockResolvedValueOnce(json(body))

    await expect(call()).resolves.toBeUndefined()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining(label))
  })

  it('logs and returns undefined on a transport failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(api.getApplianceState('a-1')).resolves.toBeUndefined()
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/^Error getting appliance state: fetch failed/))
  })

  it('logs the status and path of an HTTP error', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'boom' }, 500))

    await expect(api.sendCommand('a-1', {})).resolves.toBeUndefined()
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining('Error sending command: Request failed with status code 500 (500'),
    )
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('[PUT /api/v1/appliances/a-1/command]'))
  })

  it('returns undefined and logs when the token cannot be obtained (shutting down)', async () => {
    auth.getAccessToken.mockRejectedValueOnce(new Error('Authentication stopped'))

    await expect(api.getAppliances()).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Authentication stopped'))
  })
})

describe('403 — forced token refresh', () => {
  it('refreshes the token and retries the request once', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ error: 'forbidden' }, 403))
      .mockResolvedValueOnce(json(mockAppliancesResponse))
    auth.getAccessToken.mockResolvedValueOnce('token-1').mockResolvedValueOnce('token-2')

    await expect(api.getAppliances()).resolves.toEqual(mockAppliancesResponse)
    expect(auth.forceRefresh).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer token-2' })
  })

  it('gives up after the retry also fails', async () => {
    fetchMock.mockResolvedValue(json({ error: 'forbidden' }, 403))

    await expect(api.getApplianceInfo('a-1')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Error getting appliance info after token refresh'))
  })

  it('does not force a refresh while not logged in', async () => {
    auth.isLoggedIn = false
    fetchMock.mockResolvedValueOnce(json({ error: 'forbidden' }, 403))

    await api.getAppliances()
    expect(auth.forceRefresh).not.toHaveBeenCalled()
  })
})

describe('429 — rate limit advice', () => {
  // refreshInterval=30, applianceDiscoveryInterval=300:
  //   1 appliance:  ceil(86400/30)*1 = 2880 + 288 = 3168 < 5000 → burst explanation
  //   2 appliances: 5760 + 288 = 6048 > 5000 → suggest ≥ ceil(172800/4712) = 37 s
  it('does not retry or refresh, and explains a burst when the daily estimate is within the limit', async () => {
    fetchMock.mockResolvedValueOnce(json({}, 429))

    await expect(api.getAppliances()).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(auth.forceRefresh).not.toHaveBeenCalled()
    const lines = warnings()
    expect(lines.some((l) => l.includes('429') && l.includes('electrolux.refreshInterval'))).toBe(true)
    expect(lines).toContain(
      'Current settings: refreshInterval=30s, applianceDiscoveryInterval=300s, monitored appliances=1',
    )
    expect(lines.some((l) => l.includes('~3168') && l.includes('state polls: ~2880'))).toBe(true)
    expect(lines.some((l) => l.includes('bursting'))).toBe(true)
  })

  it('suggests a minimum refreshInterval when the known appliances exceed the daily limit', async () => {
    fetchMock.mockResolvedValueOnce(json(mockAppliancesResponse)).mockResolvedValueOnce(json({}, 429))
    await api.getAppliances() // learns 2 appliances

    await api.getApplianceState('a-1')

    expect(warnings().some((l) => l.includes('at least 37s') && l.includes('2 appliances'))).toBe(true)
  })
})

describe('appliance list logging', () => {
  const stub = (id: string, name: string) => ({
    applianceId: id,
    applianceName: name,
    applianceType: 'AC',
    created: 'x',
  })

  it('lists every appliance on the first fetch, then only additions and removals', async () => {
    fetchMock
      .mockResolvedValueOnce(json([stub('a', 'Alpha'), stub('b', 'Beta')]))
      .mockResolvedValueOnce(json([stub('a', 'Alpha'), stub('b', 'Beta')]))
      .mockResolvedValueOnce(json([stub('a', 'Alpha'), stub('c', 'Gamma')]))

    await api.getAppliances()
    const infos = () => log.info.mock.calls.map((c) => String(c[0]))
    expect(infos()).toEqual(['Found 2 appliances:', '- Alpha (a)', '- Beta (b)'])

    log.info.mockClear()
    await api.getAppliances()
    expect(infos()).toEqual([])

    await api.getAppliances()
    expect(infos()).toEqual(['New appliance found:', '- Gamma (c)', 'Appliance removed:', '- Beta (b)'])
  })
})

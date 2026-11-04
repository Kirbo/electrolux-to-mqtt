import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElectroluxAuth } from '#/electrolux-auth.js'

vi.mock('#/logger.js', () => ({
  default: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)

const SETTINGS = {
  apiKey: 'api-key',
  username: 'user@example.com',
  password: 'secret',
  countryCode: 'FI',
  renewTokenBeforeExpiryMs: 60 * 60_000,
  timeoutMs: 25_000,
}

const CSRF_URL = 'https://account.electrolux.one/ui/edp/login'
const LOGIN_URL = 'https://api.account.electrolux.one/api/v1/password/login'
const TOKEN_URL = 'https://api.developer.electrolux.one/api/v1/token'
const REFRESH_URL = 'https://api.developer.electrolux.one/api/v1/token/refresh'

/** A JWT whose payload carries exp/iat (seconds); signature is irrelevant here. */
function jwt(expiresInMs: number, tag = 'sig'): string {
  const now = Math.floor(Date.now() / 1000)
  const payload = Buffer.from(JSON.stringify({ exp: now + Math.floor(expiresInMs / 1000), iat: now })).toString(
    'base64url',
  )
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.${tag}`
}

type Route = () => Response | Promise<Response>
let routes: Record<string, Route[]>

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init.headers } })

function loginRoutes(accessToken = jwt(12 * 3600_000)): Record<string, Route[]> {
  return {
    [CSRF_URL]: [
      () =>
        new Response('<html/>', {
          headers: [
            ['x-csrf-token', 'csrf-token'],
            ['set-cookie', '_csrfSecret=csrf-secret; Path=/; HttpOnly'],
          ],
        }),
    ],
    [LOGIN_URL]: [() => json({ redirectUrl: 'https://developer.electrolux.one/generateToken?code=auth-code&state=x' })],
    [TOKEN_URL]: [
      () =>
        new Response('', {
          headers: [
            ['set-cookie', `accessToken=s%3A${accessToken}.cookiesig; Path=/; HttpOnly`],
            ['set-cookie', 'refreshToken=s%3Arefresh-1.cookiesig; Path=/; HttpOnly'],
          ],
        }),
    ],
  }
}

beforeEach(() => {
  routes = loginRoutes()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input).split('?')[0] ?? ''
    const queue = routes[url]
    const next = queue && queue.length > 1 ? queue.shift() : queue?.[0]
    if (!next) throw new Error(`unexpected fetch ${url}`)
    return next()
  })
})

afterEach(() => {
  fetchMock.mockReset()
  vi.useRealTimers()
})

const callsTo = (url: string) => fetchMock.mock.calls.filter(([input]) => String(input).split('?')[0] === url)
const bodyOf = (call: Parameters<typeof fetch> | undefined): unknown => JSON.parse(String(call?.[1]?.body))

describe('ElectroluxAuth — login', () => {
  it('logs in with the password flow and returns the access token without the cookie signature', async () => {
    const accessToken = jwt(12 * 3600_000)
    routes = loginRoutes(accessToken)
    const auth = new ElectroluxAuth(SETTINGS)

    await expect(auth.getAccessToken()).resolves.toBe(accessToken)
    expect(auth.isLoggedIn).toBe(true)

    const login = callsTo(LOGIN_URL)[0]
    expect(login?.[1]?.headers).toMatchObject({ 'x-csrf-token': 'csrf-token', Cookie: '_csrfSecret=csrf-secret' })
    expect(bodyOf(login)).toMatchObject({ email: 'user@example.com', password: 'secret', countryCode: 'FI' })
    expect(bodyOf(callsTo(TOKEN_URL)[0])).toEqual({
      code: 'auth-code',
      redirectUri: 'https://developer.electrolux.one/generateToken',
    })
    auth.cleanup()
  })

  it('applies the configured timeout to every auth request', async () => {
    const auth = new ElectroluxAuth(SETTINGS)
    await auth.getAccessToken()

    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
    }
    expect(fetchMock).toHaveBeenCalledTimes(3)
    auth.cleanup()
  })

  it('retries the login with the flattened payload after an invalid_request redirect', async () => {
    routes[LOGIN_URL] = [
      () => json({ redirectUrl: 'https://developer.electrolux.one?error=invalid_request' }),
      () => json({ redirectUrl: 'https://developer.electrolux.one/generateToken?code=second&state=x' }),
    ]
    const auth = new ElectroluxAuth(SETTINGS)
    await auth.getAccessToken()

    const logins = callsTo(LOGIN_URL)
    expect(logins).toHaveLength(2)
    expect(bodyOf(logins[1])).toMatchObject({ client_id: 'HeiOpenApi', response_type: 'code' })
    expect(bodyOf(callsTo(TOKEN_URL)[0])).toMatchObject({ code: 'second' })
    auth.cleanup()
  })

  it('shares one login between concurrent callers', async () => {
    const auth = new ElectroluxAuth(SETTINGS)
    const [a, b] = await Promise.all([auth.getAccessToken(), auth.getAccessToken()])

    expect(a).toBe(b)
    expect(callsTo(CSRF_URL)).toHaveLength(1)
    auth.cleanup()
  })

  it.each([
    ['the CSRF page is unreachable', () => routes[CSRF_URL]?.unshift(() => Promise.reject(new Error('ENOTFOUND')))],
    [
      'the login redirect carries no code',
      () => routes[LOGIN_URL]?.unshift(() => json({ redirectUrl: 'https://developer.electrolux.one/?nope=1' })),
    ],
    ['the token exchange sets no cookies', () => routes[TOKEN_URL]?.unshift(() => new Response(''))],
    [
      'the account service answers 500',
      () => routes[LOGIN_URL]?.unshift(() => json({ error: 'down' }, { status: 500 })),
    ],
  ])('keeps retrying with backoff when %s, and resolves once a later attempt succeeds', async (_case, breakOnce) => {
    vi.useFakeTimers()
    breakOnce()
    const auth = new ElectroluxAuth(SETTINGS)

    let token: string | undefined
    const pending = auth.getAccessToken().then((t) => {
      token = t
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(token).toBeUndefined()
    expect(auth.isLoggedIn).toBe(false)

    await vi.advanceTimersByTimeAsync(5_000) // first retry fires within the 5 s base delay
    await pending
    expect(token).toBeDefined()
    expect(auth.isLoggedIn).toBe(true)
    auth.cleanup()
  })

  it.each([
    ['without an exp claim', `x.${Buffer.from('{"iat":1}').toString('base64url')}.y`],
    ['that is not a JWT', 'opaque-token'],
  ])('treats an access token %s as a failed login', async (_case, badToken) => {
    vi.useFakeTimers()
    routes[TOKEN_URL]?.unshift(
      () =>
        new Response('', {
          headers: [
            ['set-cookie', `accessToken=s%3A${badToken}; Path=/`],
            ['set-cookie', 'refreshToken=s%3Ar.sig; Path=/'],
          ],
        }),
    )
    const auth = new ElectroluxAuth(SETTINGS)
    const pending = auth.getAccessToken()
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(pending).resolves.toMatch(/^eyJ/)
    expect(callsTo(TOKEN_URL)).toHaveLength(2)
    auth.cleanup()
  })

  it('stops through Symbol.dispose as well', async () => {
    vi.useFakeTimers()
    routes[CSRF_URL] = [() => Promise.reject(new Error('ENOTFOUND'))]
    const auth = new ElectroluxAuth(SETTINGS)
    const settled = auth.getAccessToken().catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(0)

    auth[Symbol.dispose]()
    expect(await settled).toBeInstanceOf(Error)
  })

  it('rejects pending callers when cleaned up during a retry wait', async () => {
    vi.useFakeTimers()
    routes[CSRF_URL] = [() => Promise.reject(new Error('ENOTFOUND'))]
    const auth = new ElectroluxAuth(SETTINGS)

    const pending = auth.getAccessToken()
    const settled = pending.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(0)
    auth.cleanup()

    expect(await settled).toBeInstanceOf(Error)
  })
})

describe('ElectroluxAuth — refresh', () => {
  it('returns the cached token while it is far from expiry', async () => {
    const auth = new ElectroluxAuth(SETTINGS)
    await auth.getAccessToken()
    fetchMock.mockClear()

    await auth.getAccessToken()
    expect(fetchMock).not.toHaveBeenCalled()
    auth.cleanup()
  })

  it('refreshes a token inside the renew window, sending the API key and refresh token', async () => {
    routes = loginRoutes(jwt(30 * 60_000)) // expires in 30 min < 60 min renew window
    const refreshed = jwt(12 * 3600_000, 'new')
    routes[REFRESH_URL] = [() => json({ accessToken: refreshed, refreshToken: 'refresh-2' })]
    const auth = new ElectroluxAuth(SETTINGS)
    await auth.getAccessToken()

    await expect(auth.getAccessToken()).resolves.toBe(refreshed)
    const refresh = callsTo(REFRESH_URL)[0]
    expect(refresh?.[1]?.headers).toMatchObject({ 'x-api-key': 'api-key' })
    expect(bodyOf(refresh)).toEqual({ refreshToken: 'refresh-1' })
    auth.cleanup()
  })

  it('forceRefresh() refreshes even a fresh token (used after a 403)', async () => {
    const refreshed = jwt(12 * 3600_000, 'forced')
    routes[REFRESH_URL] = [() => json({ accessToken: refreshed, refreshToken: 'refresh-2' })]
    const auth = new ElectroluxAuth(SETTINGS)
    await auth.getAccessToken()

    await auth.forceRefresh()
    await expect(auth.getAccessToken()).resolves.toBe(refreshed)
    auth.cleanup()
  })

  it('falls back to a full login when the refresh token is rejected (401)', async () => {
    const auth = new ElectroluxAuth(SETTINGS)
    await auth.getAccessToken()
    routes[REFRESH_URL] = [() => json({ error: 'expired' }, { status: 401 })]

    await auth.forceRefresh()

    expect(callsTo(CSRF_URL)).toHaveLength(2)
    expect(auth.isLoggedIn).toBe(true)
    auth.cleanup()
  })

  it('retries a transient refresh failure with backoff', async () => {
    vi.useFakeTimers()
    const auth = new ElectroluxAuth(SETTINGS)
    await auth.getAccessToken()
    const refreshed = jwt(12 * 3600_000, 'after-retry')
    routes[REFRESH_URL] = [
      () => json({ error: 'busy' }, { status: 503 }),
      () => json({ accessToken: refreshed, refreshToken: 'refresh-2' }),
    ]

    const pending = auth.forceRefresh()
    await vi.advanceTimersByTimeAsync(5_000)
    await pending

    expect(callsTo(REFRESH_URL)).toHaveLength(2)
    await expect(auth.getAccessToken()).resolves.toBe(refreshed)
    auth.cleanup()
  })

  it('treats a malformed refresh response as a transient failure', async () => {
    vi.useFakeTimers()
    const auth = new ElectroluxAuth(SETTINGS)
    await auth.getAccessToken()
    routes[REFRESH_URL] = [
      () => json({ unexpected: true }),
      () => json({ accessToken: jwt(12 * 3600_000), refreshToken: 'refresh-2' }),
    ]

    const pending = auth.forceRefresh()
    await vi.advanceTimersByTimeAsync(5_000)
    await pending
    expect(callsTo(REFRESH_URL)).toHaveLength(2)
    auth.cleanup()
  })
})

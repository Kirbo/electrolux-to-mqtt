import { Buffer } from 'node:buffer'
import { computeBackoffDelay } from './backoff.js'
import { describeError, HttpError, httpRequest } from './http.js'
import createLogger from './logger.js'

const logger = createLogger('electrolux')

const API_BASE_URL = 'https://api.developer.electrolux.one'
const CSRF_URL =
  'https://account.electrolux.one/ui/edp/login?response_type=code&client_id=HeiOpenApi&redirect_uri=https://developer.electrolux.one/loggedin'
const PASSWORD_LOGIN_URL = 'https://api.account.electrolux.one/api/v1/password/login'
const TOKEN_URL = `${API_BASE_URL}/api/v1/token`
const REFRESH_URL = `${API_BASE_URL}/api/v1/token/refresh`
const REDIRECT_URI = 'https://developer.electrolux.one/generateToken'
const OAUTH_STATE = 'electrolux-mqtt-client'

const RETRY_BASE_DELAY_MS = 5_000 // doubles each attempt
const RETRY_MAX_DELAY_MS = 300_000 // 5 minutes

export interface AuthSettings {
  apiKey: string
  username: string
  password: string
  countryCode: string
  renewTokenBeforeExpiryMs: number
  /** Per-request timeout for every auth call — a stalled connection must not hang the retry chain. */
  timeoutMs: number
}

interface Tokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

class AuthStoppedError extends Error {
  constructor() {
    super('Authentication stopped (shutting down)')
    this.name = 'AuthStoppedError'
  }
}

/** Value of cookie `name` from Set-Cookie headers, without attributes or the `s:` signed-cookie prefix. */
function cookieValue(setCookies: readonly string[], name: string): string | undefined {
  const cookie = setCookies.find((c) => c.startsWith(`${name}=`))
  const value = cookie?.split(';')[0]?.slice(name.length + 1)
  return value?.replace('s%3A', '')
}

function tokenExpiry(accessToken: string): number {
  const payload = accessToken.split('.')[1]
  if (!payload) throw new Error('Malformed access token: expected a JWT')
  const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'))
  if (typeof decoded !== 'object' || decoded === null || !('exp' in decoded) || typeof decoded.exp !== 'number') {
    throw new Error('Malformed access token payload: missing or invalid exp')
  }
  return decoded.exp * 1000
}

function readRedirectUrl(data: unknown): string | undefined {
  if (typeof data === 'object' && data !== null && 'redirectUrl' in data && typeof data.redirectUrl === 'string') {
    return data.redirectUrl
  }
  return undefined
}

function isTokenPair(value: unknown): value is { accessToken: string; refreshToken: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'accessToken' in value &&
    typeof value.accessToken === 'string' &&
    'refreshToken' in value &&
    typeof value.refreshToken === 'string'
  )
}

/**
 * Electrolux token lifecycle: the account password login, token refresh, and their
 * retries. Callers just `await getAccessToken()`; concurrent callers share one login or
 * refresh. Login and refresh retry with exponential backoff until they succeed (or the
 * instance is cleaned up), so a caller waits through an auth outage instead of failing.
 * Tokens live in memory only.
 */
export class ElectroluxAuth implements Disposable {
  private tokens: Tokens | null = null
  private pending: Promise<Tokens> | null = null
  private readonly stopped = new AbortController()

  constructor(private readonly settings: AuthSettings) {}

  get isLoggedIn(): boolean {
    return this.tokens !== null
  }

  /** A valid access token: cached, refreshed when inside the renew window, or a fresh login. */
  async getAccessToken(): Promise<string> {
    const tokens = this.tokens
    if (tokens) {
      const timeLeftMs = tokens.expiresAt - Date.now()
      if (timeLeftMs > this.settings.renewTokenBeforeExpiryMs) return tokens.accessToken
      if (!this.pending) {
        logger.info(`Access token is about to expire, time left "${timeLeftMs / 1000}", refreshing tokens...`)
      }
    }
    return (await this.renew()).accessToken
  }

  /** Refresh now, even if the token looks valid — e.g. after the API answered 403. */
  async forceRefresh(): Promise<void> {
    await this.renew()
  }

  /** Stop all retries; pending callers reject. */
  cleanup(): void {
    this.stopped.abort()
  }

  [Symbol.dispose](): void {
    this.cleanup()
  }

  private renew(): Promise<Tokens> {
    this.pending ??= (this.tokens ? this.refreshWithRetry() : this.loginWithRetry()).finally(() => {
      this.pending = null
    })
    return this.pending
  }

  private async loginWithRetry(): Promise<Tokens> {
    for (let attempt = 0; ; attempt++) {
      this.throwIfStopped()
      try {
        this.tokens = await this.login()
        logger.info('Logged in successfully')
        return this.tokens
      } catch (error) {
        const delay = computeBackoffDelay(attempt, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS)
        logger.error(`Error logging in: ${describeError(error)}`)
        logger.warn(`Retrying login in ${Math.round(delay / 1000)}s (attempt ${attempt + 1})...`)
        await this.sleep(delay)
      }
    }
  }

  private async refreshWithRetry(): Promise<Tokens> {
    for (let attempt = 0; ; attempt++) {
      this.throwIfStopped()
      const current = this.tokens
      if (!current) return this.loginWithRetry()
      try {
        this.tokens = await this.refresh(current.refreshToken)
        logger.info('Tokens refreshed successfully')
        return this.tokens
      } catch (error) {
        logger.error(`Error refreshing access token: ${describeError(error)}`)
        if (error instanceof HttpError && error.status === 401) {
          logger.warn('Refresh token is invalid or expired, falling back to full re-authentication...')
          this.tokens = null
          return this.loginWithRetry()
        }
        const delay = computeBackoffDelay(attempt, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS)
        logger.warn(`Retrying token refresh in ${Math.round(delay / 1000)}s (attempt ${attempt + 1})...`)
        await this.sleep(delay)
      }
    }
  }

  private async login(): Promise<Tokens> {
    logger.info('Attempting to fetch access token...')
    const csrf = await this.fetchCsrf()
    logger.debug('CSRF token retrieved successfully')

    const redirectUrl = await this.passwordLogin(csrf)
    const code = redirectUrl ? /code=([^&]*)/.exec(redirectUrl)?.[1] : undefined
    if (!code) {
      logger.error(`Failed to extract code from redirectUrl: ${redirectUrl}`)
      throw new Error('Authorization code not found in login response')
    }
    logger.info('Successfully extracted authorization code')

    logger.debug('Exchanging authorization code for tokens...')
    const response = await httpRequest({
      method: 'POST',
      url: TOKEN_URL,
      body: { code, redirectUri: REDIRECT_URI },
      timeoutMs: this.settings.timeoutMs,
    })
    const cookies = response.headers.getSetCookie()
    const accessCookie = cookieValue(cookies, 'accessToken')
    const refreshCookie = cookieValue(cookies, 'refreshToken')
    if (!accessCookie || !refreshCookie) {
      throw new Error('Failed to retrieve access or refresh token')
    }
    // The cookies are signed (`<value>.<signature>`): keep the JWT's three segments, and
    // the refresh token's first.
    const accessToken = accessCookie.split('.').slice(0, 3).join('.')
    const refreshToken = refreshCookie.split('.')[0] ?? ''
    return { accessToken, refreshToken, expiresAt: tokenExpiry(accessToken) }
  }

  private async fetchCsrf(): Promise<{ token: string; secret: string }> {
    const response = await httpRequest({ url: CSRF_URL, timeoutMs: this.settings.timeoutMs })
    const token = response.headers.get('x-csrf-token')
    if (!token) throw new Error('Failed to retrieve X-CSRF token')
    return { token, secret: cookieValue(response.headers.getSetCookie(), '_csrfSecret') ?? '' }
  }

  /** Returns the redirect URL carrying the authorization code. */
  private async passwordLogin(csrf: { token: string; secret: string }): Promise<string | undefined> {
    const headers = { 'x-csrf-token': csrf.token, Cookie: `_csrfSecret=${csrf.secret}` }
    const { username: email, password, countryCode } = this.settings
    const oauth = { response_type: 'code', client_id: 'HeiOpenApi', redirect_uri: REDIRECT_URI, state: OAUTH_STATE }
    const login = async (body: Record<string, unknown>) =>
      readRedirectUrl(
        (
          await httpRequest({
            method: 'POST',
            url: PASSWORD_LOGIN_URL,
            headers,
            body,
            timeoutMs: this.settings.timeoutMs,
          })
        ).data,
      )

    logger.debug('Sending login request to account.electrolux.one')
    const redirectUrl = await login({ email, password, postAuthAction: 'authorization', params: oauth, countryCode })
    if (!redirectUrl?.includes('error=invalid_request')) return redirectUrl

    // Some accounts reject the nested `params` shape; the flattened one works for them.
    logger.warn('Received invalid_request error, trying flattened payload structure...')
    return login({ email, password, postAuthAction: 'authorization', ...oauth, countryCode })
  }

  private async refresh(refreshToken: string): Promise<Tokens> {
    const response = await httpRequest({
      method: 'POST',
      url: REFRESH_URL,
      headers: { 'x-api-key': this.settings.apiKey },
      body: { refreshToken },
      timeoutMs: this.settings.timeoutMs,
    })
    if (!isTokenPair(response.data)) throw new Error('Invalid token refresh response')
    const { accessToken, refreshToken: nextRefreshToken } = response.data
    return { accessToken, refreshToken: nextRefreshToken, expiresAt: tokenExpiry(accessToken) }
  }

  private throwIfStopped(): void {
    if (this.stopped.signal.aborted) throw new AuthStoppedError()
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = this.stopped.signal
      if (signal.aborted) {
        reject(new AuthStoppedError())
        return
      }
      const onStop = () => {
        clearTimeout(timer)
        reject(new AuthStoppedError())
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onStop)
        resolve()
      }, ms)
      signal.addEventListener('abort', onStop, { once: true })
    })
  }
}

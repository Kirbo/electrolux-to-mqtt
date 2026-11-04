import { isAppliance } from './appliances/normalizers.js'
import { describeError, HttpError, httpRequest } from './http.js'
import createLogger from './logger.js'
import type { Appliance, ApplianceInfo, ApplianceStub } from './types.js'

const logger = createLogger('electrolux')

const API_BASE_URL = 'https://api.developer.electrolux.one'

// Electrolux API limits (developer portal): 5000 calls/day · 10 calls/second · 5 concurrent.
const RATE_LIMIT_CALLS_PER_DAY = 5000
const SECONDS_PER_DAY = 86_400

/** Where the API gets its bearer token — implemented by ElectroluxAuth. */
export interface TokenSource {
  readonly isLoggedIn: boolean
  getAccessToken(): Promise<string>
  forceRefresh(): Promise<void>
}

export interface ApiSettings {
  apiKey: string
  timeoutMs: number
  /** Only used to explain a 429 (rate limit) in the logs. */
  refreshIntervalSeconds: number
  discoveryIntervalSeconds: number
}

function isApplianceInfo(value: unknown): value is ApplianceInfo {
  return typeof value === 'object' && value !== null && 'applianceInfo' in value && 'capabilities' in value
}

function isApplianceStub(value: unknown): value is ApplianceStub {
  return (
    typeof value === 'object' &&
    value !== null &&
    'applianceId' in value &&
    'applianceName' in value &&
    'applianceType' in value &&
    'created' in value
  )
}

const isApplianceStubArray = (value: unknown): value is ApplianceStub[] =>
  Array.isArray(value) && value.every(isApplianceStub)

const anyBody = (_value: unknown): _value is unknown => true

const plural = (n: number, word: string) => `${word}${n === 1 ? '' : 's'}`

/** Logs the heading and one `- name (id)` line per entry; nothing when the list is empty. */
function logApplianceList(heading: string, entries: ReadonlyArray<[string, string]>): void {
  if (entries.length === 0) return
  logger.info(heading)
  for (const [id, name] of entries) logger.info(`- ${name} (${id})`)
}

/**
 * Typed client for the Electrolux appliance REST API. Each call resolves to the
 * validated body, or `undefined` after logging why it failed — a 403 triggers one
 * token refresh and retry, a 429 logs rate-limit advice. No MQTT, no state.
 */
export class ElectroluxApi {
  /** applianceId → name from the last successful list, for change logging and 429 advice. */
  private readonly knownAppliances = new Map<string, string>()

  constructor(
    private readonly auth: TokenSource,
    private readonly settings: ApiSettings,
  ) {}

  async getAppliances(): Promise<ApplianceStub[] | undefined> {
    const appliances = await this.request('GET', '/api/v1/appliances', isApplianceStubArray, 'Error getting appliances')
    if (appliances) this.trackAppliances(appliances)
    return appliances
  }

  async getApplianceInfo(applianceId: string): Promise<ApplianceInfo | undefined> {
    const info = await this.request(
      'GET',
      `/api/v1/appliances/${applianceId}/info`,
      isApplianceInfo,
      'Error getting appliance info',
    )
    if (info) logger.debug('Appliance info:', info)
    return info
  }

  getApplianceState(applianceId: string): Promise<Appliance | undefined> {
    return this.request('GET', `/api/v1/appliances/${applianceId}/state`, isAppliance, 'Error getting appliance state')
  }

  async sendCommand(applianceId: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await this.request(
      'PUT',
      `/api/v1/appliances/${applianceId}/command`,
      anyBody,
      'Error sending command',
      payload,
    )
    logger.debug('Command response', response)
    return response
  }

  private async request<T>(
    method: 'GET' | 'PUT',
    path: string,
    isValid: (value: unknown) => value is T,
    label: string,
    body?: unknown,
  ): Promise<T | undefined> {
    try {
      return await this.send(method, path, isValid, label, body)
    } catch (error) {
      if (error instanceof HttpError && error.status === 403 && this.auth.isLoggedIn) {
        logger.warn('Received 403 error, forcing token refresh...')
        return this.retryAfterRefresh(method, path, isValid, label, body)
      }
      if (error instanceof HttpError && error.status === 429) {
        this.logRateLimitAdvice()
      } else {
        logger.error(`${label}: ${describeError(error)}`)
      }
      return undefined
    }
  }

  private async retryAfterRefresh<T>(
    method: 'GET' | 'PUT',
    path: string,
    isValid: (value: unknown) => value is T,
    label: string,
    body?: unknown,
  ): Promise<T | undefined> {
    try {
      await this.auth.forceRefresh()
      return await this.send(method, path, isValid, label, body)
    } catch (error) {
      logger.error(`${label} after token refresh: ${describeError(error)}`)
      return undefined
    }
  }

  private async send<T>(
    method: 'GET' | 'PUT',
    path: string,
    isValid: (value: unknown) => value is T,
    label: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.auth.getAccessToken()
    const { data } = await httpRequest({
      method,
      url: `${API_BASE_URL}${path}`,
      headers: { 'x-api-key': this.settings.apiKey, Authorization: `Bearer ${token}` },
      body,
      timeoutMs: this.settings.timeoutMs,
    })
    if (!isValid(data)) {
      throw new Error(`invalid response body from ${method} ${path} (${label.replace(/^Error /, '')})`)
    }
    return data
  }

  private trackAppliances(appliances: ApplianceStub[]): void {
    const current = appliances.map((a): [string, string] => [a.applianceId, a.applianceName])
    const currentIds = new Set(current.map(([id]) => id))
    if (this.knownAppliances.size === 0) {
      logApplianceList(`Found ${current.length} ${plural(current.length, 'appliance')}:`, current)
    } else {
      const added = current.filter(([id]) => !this.knownAppliances.has(id))
      const removed = [...this.knownAppliances].filter(([id]) => !currentIds.has(id))
      logApplianceList(`New ${plural(added.length, 'appliance')} found:`, added)
      logApplianceList(`${plural(removed.length, 'Appliance')} removed:`, removed)
    }
    this.knownAppliances.clear()
    for (const [id, name] of current) this.knownAppliances.set(id, name)
  }

  private logRateLimitAdvice(): void {
    const { refreshIntervalSeconds: refresh, discoveryIntervalSeconds: discovery } = this.settings
    const appliances = Math.max(1, this.knownAppliances.size)
    // Recurring calls per day: one state poll per appliance per refresh, plus discovery.
    const stateCalls = Math.ceil((SECONDS_PER_DAY / refresh) * appliances)
    const discoveryCalls = Math.ceil(SECONDS_PER_DAY / discovery)
    const total = stateCalls + discoveryCalls
    const minRefresh = Math.ceil((SECONDS_PER_DAY * appliances) / (RATE_LIMIT_CALLS_PER_DAY - discoveryCalls))

    logger.warn(
      'Received 429 Too Many Requests from the Electrolux API — you are being rate limited. ' +
        'Please increase `electrolux.refreshInterval` or `electrolux.applianceDiscoveryInterval` in your configuration.',
    )
    logger.warn(
      `Current settings: refreshInterval=${refresh}s, applianceDiscoveryInterval=${discovery}s, monitored appliances=${appliances}`,
    )
    logger.warn(
      `Estimated API calls per day with current settings: ~${total} (state polls: ~${stateCalls}, discovery polls: ~${discoveryCalls})`,
    )
    logger.warn(
      `Electrolux API rate limits: ${RATE_LIMIT_CALLS_PER_DAY} calls/day · 10 calls/second · 5 concurrent calls`,
    )
    if (total > RATE_LIMIT_CALLS_PER_DAY) {
      logger.warn(
        `Suggested fix: set electrolux.refreshInterval to at least ${minRefresh}s ` +
          `(with ${appliances} ${plural(appliances, 'appliance')} and applianceDiscoveryInterval=${discovery}s)`,
      )
    } else {
      logger.warn(
        `Your estimated daily calls (~${total}) are within the ${RATE_LIMIT_CALLS_PER_DAY}/day limit — ` +
          'the 429 may be due to bursting (10 calls/second or 5 concurrent calls). ' +
          `Consider increasing refreshInterval above ${refresh}s as a precaution.`,
      )
    }
  }
}

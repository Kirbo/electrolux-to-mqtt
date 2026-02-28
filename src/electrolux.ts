import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import axios, { AxiosInstance } from 'axios'
import type { BaseAppliance } from './appliances/base.js'
import { cache } from './cache.js'
import config, { Tokens } from './config.js'
import createLogger from './logger.js'
import { IMqtt } from './mqtt.js'
import type { NormalizedClimateMode, NormalizedState } from './types/normalized.js'
import { Appliance, ApplianceInfo, ApplianceStub } from './types.js'

const logger = createLogger('electrolux')
const baseUrl = 'https://api.developer.electrolux.one'

// Configuration constants
const TOKEN_REFRESH_THRESHOLD_HOURS = 1 // Refresh token if it's set to expire within 1 hour
const COMMAND_STATE_DELAY_MS = 30_000 // Wait 30s after command before fetching state
const ERROR_RESPONSE_MAX_LENGTH = 200 // Max length of error response to include in logs
const LOGIN_RETRY_DELAY_MS = 5_000 // Retry login after 5s on failure
const TOKEN_REFRESH_RETRY_DELAY_MS = 5_000 // Retry token refresh after 5s on failure
const API_TIMEOUT_MS = 10_000 // Default timeout for API requests

// Track timeouts for cleanup
const activeTimeouts = new Set<NodeJS.Timeout>()

/**
 * Compare two states and log the differences
 * Exported for use in appliance classes and other modules
 */
export type StateDifference = { from: unknown; to: unknown }

export function getStateDifferences(
  oldState: NormalizedState | null,
  newState: NormalizedState,
): Record<string, StateDifference> {
  const differences: Record<string, StateDifference> = {}
  const ignoredKeys = config.logging?.ignoredKeys || []

  if (!oldState) {
    return differences
  }

  // Helper to check if a path should be ignored (exact match or parent match)
  const shouldIgnore = (path: string): boolean => {
    // Check exact match
    if (ignoredKeys.includes(path)) {
      return true
    }
    // Check if any parent path is ignored (e.g., "networkInterface" ignores "networkInterface.rssi")
    const parts = path.split('.')
    for (let i = 1; i < parts.length; i++) {
      const parentPath = parts.slice(0, i).join('.')
      if (ignoredKeys.includes(parentPath)) {
        return true
      }
    }
    return false
  }

  // Helper function to recursively compare objects and return flattened differences
  const compareValues = (oldVal: unknown, newVal: unknown, path = ''): Record<string, StateDifference> => {
    const diffs: Record<string, StateDifference> = {}

    // Normalize null/undefined
    const normalizedOld = oldVal ?? null
    const normalizedNew = newVal ?? null

    // If both are null/undefined after normalization, no change
    if (JSON.stringify(normalizedOld) === JSON.stringify(normalizedNew)) {
      return diffs
    }

    // If both are objects, recurse into them
    if (
      typeof normalizedOld === 'object' &&
      normalizedOld !== null &&
      typeof normalizedNew === 'object' &&
      normalizedNew !== null
    ) {
      const allKeys = new Set([...Object.keys(normalizedOld), ...Object.keys(normalizedNew)])
      for (const key of allKeys) {
        const fullPath = path ? `${path}.${key}` : key

        // Skip if this path or any parent is ignored
        if (shouldIgnore(fullPath)) {
          continue
        }

        const oldObj = normalizedOld as Record<string, unknown>
        const newObj = normalizedNew as Record<string, unknown>
        const nested = compareValues(oldObj[key], newObj[key], fullPath)
        Object.assign(diffs, nested)
      }
      return diffs
    }

    // Scalar value changed
    diffs[path] = { from: oldVal, to: newVal }
    return diffs
  }

  // Compare all keys in newState
  for (const key of Object.keys(newState)) {
    const oldValue = (oldState as unknown as Record<string, unknown>)[key]
    const newValue = (newState as unknown as Record<string, unknown>)[key]

    // Skip if this key is ignored
    if (shouldIgnore(key)) {
      continue
    }

    const nestedDiffs = compareValues(oldValue, newValue, key)
    Object.assign(differences, nestedDiffs)
  }

  return differences
}

export function formatStateDifferences(differences: Record<string, StateDifference>): string {
  const changes = Object.entries(differences)
    .map(([key, { from, to }]) => `\n  ${key}: ${from} → ${to}`)
    .join('')
  return changes
}

// Helper to extract URL path from absolute or relative URLs
function extractUrlPath(url: string | undefined): string {
  if (!url) return ''

  try {
    return new URL(url).pathname
  } catch {
    // If url is a relative path, use it directly
    return url
  }
}

function formatAxiosError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const statusText = error.response?.statusText
    const method = error.config?.method?.toUpperCase()
    const url = error.config?.url
    const message = error.message

    let formatted = message
    if (status) {
      const statusPart = statusText ? ` ${statusText}` : ''
      formatted += ` (${status}${statusPart})`
    }
    if (method && url) {
      const urlPath = extractUrlPath(url)
      formatted += ` [${method} ${urlPath}]`
    }

    // Add response data if available and not too large
    if (error.response?.data && typeof error.response.data === 'object') {
      const responseStr = JSON.stringify(error.response.data)
      if (responseStr.length < ERROR_RESPONSE_MAX_LENGTH) {
        formatted += ` - ${responseStr}`
      }
    }

    return formatted
  }
  return String(error)
}

export class ElectroluxClient {
  private client?: AxiosInstance
  accessToken?: string = config.electrolux.accessToken
  refreshToken?: string = config.electrolux.refreshToken
  eat?: Date = config.electrolux.eat
  iat?: Date = config.electrolux.iat
  private readonly mqtt: IMqtt
  private readonly lastCommandTime: Map<string, number> = new Map() // Track when commands were sent per appliance
  private readonly lastActiveMode: Map<string, NormalizedClimateMode> = new Map()
  private readonly previousAppliances: Map<string, string> = new Map() // applianceId -> applianceName

  public isLoggingIn = false
  public isLoggedIn = false
  public refreshInterval: number = config.electrolux.refreshInterval ?? 30

  constructor(mqtt: IMqtt) {
    this.mqtt = mqtt
  }

  /**
   * Cleanup all pending timeouts
   * Should be called on application shutdown
   */
  public cleanup() {
    for (const timeout of activeTimeouts) {
      clearTimeout(timeout)
    }
    activeTimeouts.clear()
  }

  /**
   * Remove tracking data for a specific appliance
   * Should be called when an appliance is removed
   */
  public removeAppliance(applianceId: string) {
    this.lastCommandTime.delete(applianceId)
    this.lastActiveMode.delete(applianceId)
    this.previousAppliances.delete(applianceId)
  }

  public async initialize() {
    await this.createApiClient()
  }

  private async createApiClient() {
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': config.electrolux.apiKey,
      ...(this.accessToken && this.eat && this.refreshToken && { Authorization: `Bearer ${this.accessToken}` }),
    }

    if (headers.Authorization) {
      this.isLoggedIn = true
    }

    this.client = axios.create({
      baseURL: baseUrl,
      headers,
      timeout: API_TIMEOUT_MS,
    })

    this.client.interceptors.request.use(async (request) => {
      if (request.url !== '/api/v1/token/refresh') {
        while (this.isLoggingIn) {
          logger.debug('Waiting for login to complete...')
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
      return request
    })

    this.isLoggedIn = !!this.accessToken
  }

  private async getXcsrfToken() {
    try {
      const response = await axios.get(
        'https://account.electrolux.one/ui/edp/login?response_type=code&client_id=HeiOpenApi&redirect_uri=https://developer.electrolux.one/loggedin',
      )
      const { headers } = response

      const xcsrfToken = headers['x-csrf-token']
      const setCookieHeader = headers['set-cookie']
      let csrfSecret = ''

      if (setCookieHeader && Array.isArray(setCookieHeader)) {
        const csrfSecretCookie = setCookieHeader.find((cookie) => cookie.startsWith('_csrfSecret='))
        if (csrfSecretCookie) {
          csrfSecret = csrfSecretCookie.split(';')[0].split('=')[1]
        }
      }

      return { xcsrfToken, csrfSecret }
    } catch (error) {
      logger.error(`Error getting X-CSRF token: ${formatAxiosError(error)}`)
      return undefined
    }
  }

  public async login() {
    this.isLoggingIn = true
    this.isLoggedIn = false
    logger.info('Attempting to fetch access token...')

    const tokenData = await this.getXcsrfToken()
    if (!tokenData) {
      this.isLoggingIn = false
      throw new Error('Failed to retrieve X-CSRF token data')
    }
    const { xcsrfToken, csrfSecret } = tokenData
    logger.debug('CSRF token retrieved successfully')

    try {
      // Try first payload structure (with state parameter)
      let body: Record<string, string | Record<string, string>> = {
        email: config.electrolux.username,
        password: config.electrolux.password,
        postAuthAction: 'authorization',
        params: {
          response_type: 'code',
          client_id: 'HeiOpenApi',
          redirect_uri: 'https://developer.electrolux.one/generateToken',
          state: 'electrolux-mqtt-client', // Add state parameter
        },
        countryCode: config.electrolux.countryCode,
      }

      const headers = {
        headers: {
          'x-csrf-token': xcsrfToken,
          Cookie: `_csrfSecret=${csrfSecret}`,
        },
      }

      logger.debug(`Sending login request to account.electrolux.one`)
      let response = await axios.post('https://api.account.electrolux.one/api/v1/password/login', body, headers)
      logger.debug(`Password login response status: ${response.status}`)

      // Check if we got an error redirect
      let redirectUrl = response.data.redirectUrl
      if (redirectUrl?.includes('error=invalid_request')) {
        logger.warn('Received invalid_request error, trying flattened payload structure...')

        // Try second structure (flattened params with state)
        body = {
          email: config.electrolux.username,
          password: config.electrolux.password,
          postAuthAction: 'authorization',
          response_type: 'code',
          client_id: 'HeiOpenApi',
          redirect_uri: 'https://developer.electrolux.one/generateToken',
          state: 'electrolux-mqtt-client',
          countryCode: config.electrolux.countryCode,
        }

        response = await axios.post('https://api.account.electrolux.one/api/v1/password/login', body, headers)
        logger.debug(`Password login with flattened payload response status: ${response.status}`)
        redirectUrl = response.data.redirectUrl
      }

      const code = redirectUrl.match(/code=([^&]*)/)?.[1]
      if (!code) {
        logger.error(`Failed to extract code from redirectUrl: ${redirectUrl}`)
        throw new Error('Authorization code not found in login response')
      }

      logger.info('Successfully extracted authorization code')

      const tokenBody = {
        code,
        redirectUri: 'https://developer.electrolux.one/generateToken',
      }

      logger.debug('Exchanging authorization code for tokens...')
      const cookies = await axios.post('https://api.developer.electrolux.one/api/v1/token', tokenBody)
      logger.debug(`Token exchange response status: ${cookies.status}`)

      const setCookieHeader = cookies.headers['set-cookie']
      if (setCookieHeader && Array.isArray(setCookieHeader)) {
        const accessTokenCookie = setCookieHeader.find((cookie) => cookie.startsWith('accessToken='))
        const refreshTokenCookie = setCookieHeader.find((cookie) => cookie.startsWith('refreshToken='))

        if (accessTokenCookie) {
          this.accessToken = this.sanitizeToken(accessTokenCookie.split(';')[0].split('=')[1])
            .split('.')
            .slice(0, 3)
            .join('.')
          const { eat, iat } = this.parseAccessTokenPayload(this.accessToken)
          this.eat = eat
          this.iat = iat
        }

        if (refreshTokenCookie) {
          this.refreshToken = this.sanitizeToken(refreshTokenCookie.split(';')[0].split('=')[1]).split('.')?.[0]
        }
      }

      if (!this.accessToken || !this.refreshToken || !this.eat || !this.iat) {
        throw new Error('Failed to retrieve access or refresh token')
      }

      const tokens = this.buildTokensObject()
      logger.info('Logged in, Tokens', this.retainTokensForOutput(tokens))
      this.saveTokens(tokens)

      this.createApiClient()

      this.isLoggedIn = true
      this.isLoggingIn = false

      return true
    } catch (error) {
      this.isLoggedIn = false
      this.isLoggingIn = false
      logger.error(`Error logging in: ${formatAxiosError(error)}`)
      const retryTimeout = setTimeout(async () => {
        activeTimeouts.delete(retryTimeout)
        await this.login()
      }, LOGIN_RETRY_DELAY_MS)
      activeTimeouts.add(retryTimeout)
      return false
    }
  }

  private readonly sanitizeToken = (token: string) => {
    return token.replace('s%3A', '')
  }

  private parseAccessTokenPayload(accessToken: string): { eat: Date; iat: Date } {
    const tokenPayload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf-8'))
    return {
      eat: new Date(tokenPayload.exp * 1000),
      iat: new Date(tokenPayload.iat * 1000),
    }
  }

  private buildTokensObject(): Partial<Tokens> {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      eat: this.eat ? this.eat.getTime() / 1000 : undefined,
      iat: this.iat ? this.iat.getTime() / 1000 : undefined,
    }
  }

  private saveTokens(tokens: Partial<Tokens>): void {
    const filePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../tokens.json')
    try {
      fs.writeFileSync(filePath, JSON.stringify(tokens, null, 2), 'utf-8')
      logger.debug('Tokens saved to', filePath)
    } catch (writeError) {
      logger.warn(`Failed to persist tokens to ${filePath}: ${formatAxiosError(writeError)}`)
    }
  }

  private readonly retainTokensForOutput = (tokens: Partial<Tokens>) => {
    return {
      ...tokens,
      accessToken: `${this.accessToken?.slice(0, 10)}...token length ${this.accessToken?.length}...${this.accessToken?.slice(-10)}`,
      refreshToken: `${this.refreshToken?.slice(0, 10)}...token length ${this.refreshToken?.length}...${this.refreshToken?.slice(-10)}`,
    }
  }

  public async ensureValidToken() {
    try {
      if (!this.accessToken || !this.eat) {
        await this.login()
        return
      }

      const now = new Date()
      const timeLeft = this.eat.getTime() - now.getTime()
      const readableTimeLeft = timeLeft / 1000

      if (timeLeft <= 1000 * 60 * 60 * TOKEN_REFRESH_THRESHOLD_HOURS) {
        logger.info(`Access token is about to expire, time left "${readableTimeLeft}", refreshing tokens...`)
        this.isLoggedIn = false
        await this.refreshTokens()
      } else {
        logger.debug(`Access token is valid, time left "${readableTimeLeft}"`)
      }
    } catch (error) {
      logger.error(`Error ensuring valid token: ${formatAxiosError(error)}`)
    }
  }

  public async refreshTokens() {
    this.isLoggingIn = true
    try {
      if (!this.client) {
        throw new Error('API client is not initialized')
      }
      const response = await this.client.post('/api/v1/token/refresh', {
        refreshToken: this.refreshToken,
      })

      const { data } = response

      this.accessToken = data.accessToken
      this.refreshToken = data.refreshToken

      if (!this.accessToken || !this.refreshToken) {
        throw new Error('Access token is undefined')
      }

      const { eat, iat } = this.parseAccessTokenPayload(this.accessToken)
      this.eat = eat
      this.iat = iat

      this.isLoggedIn = true

      const tokens = this.buildTokensObject()
      logger.info('Refreshed tokens', this.retainTokensForOutput(tokens))
      this.saveTokens(tokens)

      // Recreate API client with new access token
      await this.createApiClient()

      this.isLoggingIn = false
      this.isLoggedIn = true

      // Small delay to ensure the new client is fully ready
      await new Promise((resolve) => setTimeout(resolve, 100))
    } catch (error) {
      logger.error(`Error refreshing access token: ${formatAxiosError(error)}`)

      if (axios.isAxiosError(error) && error.response?.status === 401) {
        // Refresh token is rejected by the server — clear stored tokens and re-authenticate from scratch
        logger.warn('Refresh token is invalid or expired, falling back to full re-authentication...')
        this.accessToken = undefined
        this.refreshToken = undefined
        this.eat = undefined
        this.iat = undefined
        this.isLoggingIn = false
        await this.login()
      } else {
        // Transient error (network issue, 5xx) — retry the refresh after a short delay
        const retryTimeout = setTimeout(async () => {
          activeTimeouts.delete(retryTimeout)
          await this.refreshTokens()
        }, TOKEN_REFRESH_RETRY_DELAY_MS)
        activeTimeouts.add(retryTimeout)
      }
    }
  }

  private logApplianceChanges(appliances: ApplianceStub[]): void {
    const currentIds = new Set(appliances.map((a: ApplianceStub) => a.applianceId))
    const added = appliances.filter((a: ApplianceStub) => !this.previousAppliances.has(a.applianceId))
    const removed = Array.from(this.previousAppliances.keys()).filter((id) => !currentIds.has(id))

    if (this.previousAppliances.size === 0) {
      this.logInitialAppliances(appliances)
    } else if (added.length > 0 || removed.length > 0) {
      this.logAddedAndRemovedAppliances(added, removed)
    }

    // Update cached appliance list
    this.previousAppliances.clear()
    for (const appliance of appliances) {
      this.previousAppliances.set(appliance.applianceId, appliance.applianceName)
    }
  }

  private logInitialAppliances(appliances: ApplianceStub[]): void {
    logger.info(`Found ${appliances.length} appliance${appliances.length === 1 ? '' : 's'}:`)
    for (const appliance of appliances) {
      logger.info(`- ${appliance.applianceName} (${appliance.applianceId})`)
    }
  }

  private logAddedAndRemovedAppliances(added: ApplianceStub[], removed: string[]): void {
    if (added.length > 0) {
      logger.info(`New appliance${added.length === 1 ? '' : 's'} found:`)
      for (const appliance of added) {
        logger.info(`- ${appliance.applianceName} (${appliance.applianceId})`)
      }
    }
    if (removed.length > 0) {
      logger.info(`Appliance${removed.length === 1 ? '' : 's'} removed:`)
      for (const applianceId of removed) {
        const name = this.previousAppliances.get(applianceId)
        logger.info(`- ${name ?? 'Unknown'} (${applianceId})`)
      }
    }
  }

  private logRateLimitAdvice(): void {
    const RATE_LIMIT_CALLS_PER_DAY = 5000
    const SECONDS_PER_DAY = 86400
    const numAppliances = Math.max(1, this.previousAppliances.size)
    const currentRefreshInterval = this.refreshInterval
    const currentDiscoveryInterval = config.electrolux.applianceDiscoveryInterval ?? 300

    // Recurring calls per day:
    // - State polling: numAppliances × (86400 / refreshInterval)
    // - Appliance discovery: 86400 / applianceDiscoveryInterval
    const stateCallsPerDay = Math.ceil((SECONDS_PER_DAY / currentRefreshInterval) * numAppliances)
    const discoveryCallsPerDay = Math.ceil(SECONDS_PER_DAY / currentDiscoveryInterval)
    const estimatedCallsPerDay = stateCallsPerDay + discoveryCallsPerDay

    // Minimum refreshInterval so that state + discovery calls stay within the daily limit
    const availableForStatePolls = RATE_LIMIT_CALLS_PER_DAY - discoveryCallsPerDay
    const minRefreshInterval = Math.ceil((SECONDS_PER_DAY * numAppliances) / availableForStatePolls)

    logger.warn(
      'Received 429 Too Many Requests from the Electrolux API — you are being rate limited. ' +
        'Please increase `electrolux.refreshInterval` or `electrolux.applianceDiscoveryInterval` in your configuration.',
    )
    logger.warn(
      `Current settings: refreshInterval=${currentRefreshInterval}s, ` +
        `applianceDiscoveryInterval=${currentDiscoveryInterval}s, ` +
        `monitored appliances=${numAppliances}`,
    )
    logger.warn(
      `Estimated API calls per day with current settings: ~${estimatedCallsPerDay} ` +
        `(state polls: ~${stateCallsPerDay}, discovery polls: ~${discoveryCallsPerDay})`,
    )
    logger.warn(
      `Electrolux API rate limits: ${RATE_LIMIT_CALLS_PER_DAY} calls/day · 10 calls/second · 5 concurrent calls`,
    )
    if (estimatedCallsPerDay > RATE_LIMIT_CALLS_PER_DAY) {
      logger.warn(
        `Suggested fix: set electrolux.refreshInterval to at least ${minRefreshInterval}s ` +
          `(with ${numAppliances} appliance${numAppliances === 1 ? '' : 's'} and applianceDiscoveryInterval=${currentDiscoveryInterval}s)`,
      )
    } else {
      logger.warn(
        `Your estimated daily calls (~${estimatedCallsPerDay}) are within the ${RATE_LIMIT_CALLS_PER_DAY}/day limit — ` +
          `the 429 may be due to bursting (10 calls/second or 5 concurrent calls). ` +
          `Consider increasing refreshInterval above ${currentRefreshInterval}s as a precaution.`,
      )
    }
  }

  private async handleApiRequest<T>(requestFn: () => Promise<T>, errorMessage: string): Promise<T | undefined> {
    try {
      return await requestFn()
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403 && this.isLoggedIn) {
        logger.warn('Received 403 error, forcing token refresh...')
        this.isLoggedIn = false
        await this.refreshTokens()

        try {
          return await requestFn()
        } catch (retryError) {
          logger.error(`${errorMessage} after token refresh: ${formatAxiosError(retryError)}`)
        }
      } else if (axios.isAxiosError(error) && error.response?.status === 429) {
        this.logRateLimitAdvice()
      } else {
        logger.error(`${errorMessage}: ${formatAxiosError(error)}`)
      }
      return undefined
    }
  }

  private buildCombinedCommandState(
    cachedNormalizedState: NormalizedState,
    rawCommand: Partial<NormalizedState>,
    applianceId: string,
  ): NormalizedState {
    // Track last non-off mode from command if applicable
    if (rawCommand.mode && rawCommand.mode.toLowerCase() !== 'off') {
      this.lastActiveMode.set(applianceId, rawCommand.mode)
    }

    const lastMode = this.lastActiveMode.get(applianceId)
    const isOffCommand = rawCommand.mode?.toLowerCase() === 'off'

    const combinedState: NormalizedState = {
      ...cachedNormalizedState,
      ...rawCommand,
    }

    // If the command explicitly turns the unit off, keep the previous non-off mode for UI state
    if (isOffCommand && lastMode) {
      combinedState.mode = lastMode
    }

    // If the appliance was off and a non-mode command comes in (e.g., fan speed/temperature),
    // turn it on and restore the last active mode
    if (!rawCommand.mode && cachedNormalizedState.applianceState === 'off' && lastMode) {
      combinedState.applianceState = 'on'
      combinedState.mode = lastMode
    }

    return combinedState
  }

  private publishCommandFeedback(
    appliance: BaseAppliance,
    rawCommand: Partial<NormalizedState>,
    payload: Record<string, unknown>,
    applianceId: string,
    cacheKey: string,
  ): void {
    const cachedRawState = cache.get(cacheKey) as Appliance | null
    const cachedNormalizedState = cachedRawState ? appliance.normalizeState(cachedRawState) : null

    if (!cachedNormalizedState) {
      logger.warn('No cached state available for immediate feedback after command')
      return
    }

    const combinedState = this.buildCombinedCommandState(cachedNormalizedState, rawCommand, applianceId)

    // Apply any appliance-specific immediate state updates derived from the command
    const immediateStateUpdates = appliance.deriveImmediateStateFromCommand(payload)
    if (immediateStateUpdates) {
      Object.assign(combinedState, immediateStateUpdates)
    }

    // Publish immediate feedback to MQTT
    this.mqtt.publish(`${applianceId}/state`, JSON.stringify(combinedState))

    // Update cache with the combined state so comparisons after the command delay work correctly
    cache.set(cacheKey, combinedState)
  }

  public async getAppliances() {
    return this.handleApiRequest(async () => {
      await this.ensureValidToken()
      if (!this.client) {
        throw new Error('API client is not initialized')
      }
      const response = await this.client.get('/api/v1/appliances')
      const appliances = response.data satisfies ApplianceStub[]
      this.logApplianceChanges(appliances)
      return appliances
    }, 'Error getting appliances')
  }

  public async getApplianceInfo(applianceId: string) {
    return this.handleApiRequest(async () => {
      await this.ensureValidToken()
      if (!this.client) {
        throw new Error('API client is not initialized')
      }
      const response = await this.client.get(`/api/v1/appliances/${applianceId}/info`)
      logger.debug('Appliance info:', response.data)
      return response.data as ApplianceInfo
    }, 'Error getting appliance info')
  }

  private prepareStateForPublishing(
    appliance: BaseAppliance,
    normalizedState: NormalizedState | null,
    cachedNormalizedState: NormalizedState | null,
  ): NormalizedState | null {
    const applianceId = appliance.getApplianceId()

    // Track last non-off mode from authoritative API state
    if (normalizedState?.mode && normalizedState.mode !== 'off') {
      this.lastActiveMode.set(applianceId, normalizedState.mode)
    }

    // If new state is incomplete, use cached normalized state for publishing
    if (!normalizedState && cachedNormalizedState) {
      logger.debug(`Using cached state for appliance ${applianceId} due to incomplete API response`)
      return cachedNormalizedState
    }

    return normalizedState
  }

  private logStateChanges(appliance: BaseAppliance, differences: Record<string, StateDifference>): boolean {
    const hasChanges = Object.keys(differences).length > 0

    if (hasChanges) {
      const changesSummary = formatStateDifferences(differences)
      if (config.logging?.showChanges) {
        logger.info(`State changed for appliance ${appliance.getApplianceId()} via API: ${changesSummary}`)
      } else {
        logger.info(`State changed for appliance ${appliance.getApplianceId()} via API`)
      }
    } else {
      logger.debug('State checked, no changes detected')
    }

    return hasChanges
  }

  private publishStateIfChanged(
    applianceId: string,
    cacheKey: string,
    stateToPublish: NormalizedState,
    responseData: Appliance,
    options: {
      hasChanges: boolean
      isFirstFetch: boolean
      callback?: () => void
      normalizedState?: NormalizedState | null
    },
  ): void {
    if (options.hasChanges || options.isFirstFetch) {
      cache.set(cacheKey, responseData)
      this.mqtt.publish(`${applianceId}/state`, JSON.stringify(stateToPublish))

      // Only call callback if we have changes (not on first fetch)
      if (options.callback && options.normalizedState && options.hasChanges) {
        options.callback()
      }
    }
  }

  private async fetchAndProcessApplianceState(
    appliance: BaseAppliance,
    applianceId: string,
    cacheKey: string,
    callback?: () => void,
  ): Promise<Appliance> {
    if (!this.client) {
      throw new Error('API client is not initialized')
    }
    const response = await this.client.get(`/api/v1/appliances/${applianceId}/state`)

    const cachedRawState = cache.get(cacheKey) as Appliance | null
    const cachedNormalizedState = cachedRawState ? appliance.normalizeState(cachedRawState) : null
    const normalizedState = appliance.normalizeState(response.data)

    const stateToPublish = this.prepareStateForPublishing(appliance, normalizedState, cachedNormalizedState)
    if (!stateToPublish) {
      return response.data
    }

    const differences = getStateDifferences(cachedNormalizedState, stateToPublish)
    const hasChanges = this.logStateChanges(appliance, differences)
    const isFirstFetch = !cachedNormalizedState

    this.publishStateIfChanged(applianceId, cacheKey, stateToPublish, response.data, {
      hasChanges,
      isFirstFetch,
      callback,
      normalizedState,
    })

    return response.data
  }

  public async getApplianceState(appliance: BaseAppliance, callback?: () => void): Promise<Appliance | undefined> {
    const applianceId = appliance.getApplianceId()
    const cacheKey = cache.cacheKey(applianceId).state

    // Skip fetching state if a command was sent recently
    const lastCommandTime = this.lastCommandTime.get(applianceId) ?? 0
    const timeSinceCommand = Date.now() - lastCommandTime

    if (timeSinceCommand < COMMAND_STATE_DELAY_MS) {
      logger.debug(
        `Skipping state fetch for ${applianceId}: only ${Math.round(timeSinceCommand / 1000)}s since command was sent (waiting ${Math.round((COMMAND_STATE_DELAY_MS - timeSinceCommand) / 1000)}s more)`,
      )
      return cache.get(cacheKey) as Appliance
    }

    return this.handleApiRequest(async () => {
      await this.ensureValidToken()
      return this.fetchAndProcessApplianceState(appliance, applianceId, cacheKey, callback)
    }, 'Error getting appliance state')
  }

  public async sendApplianceCommand(appliance: BaseAppliance, rawCommand: Partial<NormalizedState>) {
    const applianceId = appliance.getApplianceId()
    const cacheKey = cache.cacheKey(applianceId).state

    return this.handleApiRequest(async () => {
      await this.ensureValidToken()
      if (!this.client) {
        throw new Error('API client is not initialized')
      }

      const payload = appliance.transformMqttCommandToApi(rawCommand)
      logger.info('Sending command to appliance:', applianceId, 'Command:', payload)

      this.lastCommandTime.set(applianceId, Date.now())

      const response = await this.client.put(`/api/v1/appliances/${applianceId}/command`, payload)
      logger.debug('Command response', response.status, response.data)

      this.publishCommandFeedback(appliance, rawCommand, payload, applianceId, cacheKey)

      return response.data
    }, 'Error sending command')
  }
}

export default ElectroluxClient

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
const TOKEN_REFRESH_THRESHOLD_HOURS = 6
const COMMAND_STATE_DELAY_MS = 30_000 // Wait 30s after command before fetching state
const ERROR_RESPONSE_MAX_LENGTH = 200 // Max length of error response to include in logs
const LOGIN_RETRY_DELAY_MS = 5_000 // Retry login after 5s on failure
const TOKEN_REFRESH_RETRY_DELAY_MS = 5_000 // Retry token refresh after 5s on failure

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
  private accessToken?: string = config.electrolux.accessToken
  private refreshToken?: string = config.electrolux.refreshToken
  private eat?: Date = config.electrolux.eat
  private iat?: Date = config.electrolux.iat
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
          const tokenPayload = JSON.parse(Buffer.from(this.accessToken.split('.')[1], 'base64').toString('utf-8'))
          this.eat = new Date(tokenPayload.exp * 1000)
          this.iat = new Date(tokenPayload.iat * 1000)
          logger.debug('tokenPayload', tokenPayload)
        }

        if (refreshTokenCookie) {
          this.refreshToken = this.sanitizeToken(refreshTokenCookie.split(';')[0].split('=')[1]).split('.')?.[0]
        }
      }

      if (!this.accessToken || !this.refreshToken || !this.eat || !this.iat) {
        throw new Error('Failed to retrieve access or refresh token')
      }

      const tokens: Partial<Tokens> = {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        eat: this.eat.getTime() / 1000,
        iat: this.iat.getTime() / 1000,
      }

      logger.info('Logged in, Tokens', this.retainTokensForOutput(tokens))

      const filePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../tokens.json')
      fs.writeFileSync(filePath, JSON.stringify(tokens, null, 2), 'utf-8')

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

      const tokenPayload = JSON.parse(Buffer.from(this.accessToken.split('.')[1], 'base64').toString('utf-8'))
      this.eat = new Date(tokenPayload.exp * 1000)
      this.iat = new Date(tokenPayload.iat * 1000)

      this.isLoggedIn = true

      const tokens: Partial<Tokens> = {
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        eat: this.eat.getTime() / 1000,
        iat: this.iat.getTime() / 1000,
      }

      logger.info('Refreshed tokens', this.retainTokensForOutput(tokens))

      const filePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../tokens.json')
      fs.writeFileSync(filePath, JSON.stringify(tokens, null, 2), 'utf-8')
      logger.debug('Tokens saved to', filePath)

      // Recreate API client with new access token
      await this.createApiClient()

      this.isLoggingIn = false
      this.isLoggedIn = true

      // Small delay to ensure the new client is fully ready
      await new Promise((resolve) => setTimeout(resolve, 100))
    } catch (error) {
      logger.error(`Error refreshing access token: ${formatAxiosError(error)}`)
      const retryTimeout = setTimeout(async () => {
        activeTimeouts.delete(retryTimeout)
        await this.refreshTokens()
      }, TOKEN_REFRESH_RETRY_DELAY_MS)
      activeTimeouts.add(retryTimeout)
    }
  }

  public async getAppliances() {
    try {
      await this.ensureValidToken()
      if (!this.client) {
        throw new Error('API client is not initialized')
      }
      const response = await this.client.get('/api/v1/appliances')
      const appliances = response.data satisfies ApplianceStub[]

      // Log only on first run or when appliances change
      const currentIds = new Set(appliances.map((a: ApplianceStub) => a.applianceId))
      const added = appliances.filter((a: ApplianceStub) => !this.previousAppliances.has(a.applianceId))
      const removed = Array.from(this.previousAppliances.keys()).filter((id) => !currentIds.has(id))

      if (this.previousAppliances.size === 0) {
        logger.info(`Found ${appliances.length} appliance${appliances.length === 1 ? '' : 's'}:`)
        for (const appliance of appliances) {
          logger.info(`- ${appliance.applianceName} (${appliance.applianceId})`)
        }
      } else if (added.length > 0 || removed.length > 0) {
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

      // Update cached appliance list
      this.previousAppliances.clear()
      for (const appliance of appliances) {
        this.previousAppliances.set(appliance.applianceId, appliance.applianceName)
      }

      return appliances
    } catch (error) {
      logger.error(`Error getting appliances: ${formatAxiosError(error)}`)
    }
  }

  public async getApplianceInfo(applianceId: string) {
    try {
      await this.ensureValidToken()
      if (!this.client) {
        throw new Error('API client is not initialized')
      }
      const response = await this.client.get(`/api/v1/appliances/${applianceId}/info`)
      logger.debug('Appliance info:', response.data)
      return response.data as ApplianceInfo
    } catch (error) {
      logger.error(`Error getting appliance info: ${formatAxiosError(error)}`)
    }
  }

  private handleStateChanges(
    appliance: BaseAppliance,
    stateToPublish: NormalizedState,
    cachedState: Appliance | null,
  ): void {
    const cachedNormalized = cachedState ? appliance.normalizeState(cachedState) : null
    const differences = getStateDifferences(cachedNormalized, stateToPublish)
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
  }

  public async getApplianceState(appliance: BaseAppliance, callback?: () => void): Promise<Appliance | undefined> {
    const applianceId = appliance.getApplianceId()
    const cacheKey = cache.cacheKey(applianceId).state

    // Skip fetching state if a command was sent recently (within 30 seconds) to avoid stale API cache
    const lastCommandTime = this.lastCommandTime.get(applianceId) ?? 0
    const timeSinceCommand = Date.now() - lastCommandTime

    if (timeSinceCommand < COMMAND_STATE_DELAY_MS) {
      logger.debug(
        `Skipping state fetch for ${applianceId}: only ${Math.round(timeSinceCommand / 1000)}s since command was sent (waiting ${Math.round((COMMAND_STATE_DELAY_MS - timeSinceCommand) / 1000)}s more)`,
      )
      return cache.get(cacheKey) as Appliance
    }

    try {
      await this.ensureValidToken()
      if (!this.client) {
        throw new Error('API client is not initialized')
      }
      const response = await this.client.get(`/api/v1/appliances/${applianceId}/state`)

      // Get the cached state BEFORE checking if the new response matches
      const cachedState = cache.get(cacheKey) as Appliance | null

      if (cache.matchByValue(cacheKey, response.data)) {
        return cache.get(cacheKey) as Appliance
      }

      const normalizedState = appliance.normalizeState(response.data)

      // Track last non-off mode from authoritative API state so we can restore it after OFF commands
      if (normalizedState?.mode && normalizedState.mode !== 'off') {
        this.lastActiveMode.set(applianceId, normalizedState.mode)
      }

      // If new state is incomplete, use cached normalized state for publishing
      // but DON'T cache the incomplete response
      let stateToPublish = normalizedState
      if (!normalizedState && cachedState) {
        logger.debug(`Using cached state for appliance ${applianceId} due to incomplete API response`)
        stateToPublish = appliance.normalizeState(cachedState)
      }

      if (!stateToPublish) {
        return response.data
      }

      // Compare normalized states and log changes
      this.handleStateChanges(appliance, stateToPublish, cachedState)

      // Only update the cache with the new state if it's complete
      if (normalizedState) {
        cache.set(cacheKey, response.data)
      }

      this.mqtt.publish(`${applianceId}/state`, JSON.stringify(stateToPublish))

      // Only call callback if we have a valid normalized state
      if (callback && normalizedState) {
        callback()
      }

      return response.data
    } catch (error) {
      logger.error(`Error getting appliance state: ${formatAxiosError(error)}`)
      this.mqtt.publish(
        `${applianceId}/state`,
        JSON.stringify({ applianceId, connectionState: 'disconnected', applianceState: 'off' }),
      )
    }
  }

  public async sendApplianceCommand(appliance: BaseAppliance, rawCommand: Partial<NormalizedState>) {
    const applianceId = appliance.getApplianceId()
    const cacheKey = cache.cacheKey(applianceId).state

    try {
      await this.ensureValidToken()
      if (!this.client) {
        throw new Error('API client is not initialized')
      }

      // Transform the MQTT command to Electrolux API format using the appliance-specific logic
      const payload = appliance.transformMqttCommandToApi(rawCommand)

      logger.info('Sending command to appliance:', applianceId, 'Command:', payload)

      // Record the time the command was sent to avoid fetching stale state
      this.lastCommandTime.set(applianceId, Date.now())

      const response = await this.client.put(`/api/v1/appliances/${applianceId}/command`, payload)
      logger.debug('Command response', response.status, response.data)

      const state = await this.getApplianceState(appliance)
      if (!state) {
        logger.error('Failed to get appliance state after sending command')
        return
      }

      const normalizedState = appliance.normalizeState(state)

      // Track last non-off mode from authoritative API state so we can restore it after OFF commands
      if (normalizedState?.mode && normalizedState.mode !== 'off') {
        this.lastActiveMode.set(applianceId, normalizedState.mode)
      }

      // Combine the normalized state with the command values to ensure immediate feedback,
      // while preserving the last active mode when turning off.
      const lastMode = this.lastActiveMode.get(applianceId)
      const isOffCommand = rawCommand.mode?.toLowerCase() === 'off'

      const combinedState: NormalizedState = {
        ...normalizedState,
        ...rawCommand,
      }

      // If the command explicitly turns the unit off, keep the previous non-off mode for UI state
      if (isOffCommand && lastMode) {
        combinedState.mode = lastMode
      }

      // If the command sets a new non-off mode, remember it for future OFF/ON transitions
      if (rawCommand.mode && rawCommand.mode.toLowerCase() !== 'off') {
        this.lastActiveMode.set(applianceId, rawCommand.mode as NormalizedClimateMode)
      }

      // If the appliance was off and a non-mode command comes in (e.g., fan speed/temperature),
      // restore the last active mode so Home Assistant shows the previous mode instead of "off".
      if (!rawCommand.mode && normalizedState.mode === 'off' && lastMode) {
        combinedState.mode = lastMode
      }

      // Apply any appliance-specific immediate state updates derived from the command
      const immediateStateUpdates = appliance.deriveImmediateStateFromCommand(payload)
      if (immediateStateUpdates) {
        Object.assign(combinedState, immediateStateUpdates)
      }

      if (cache.matchByValue(cacheKey, combinedState)) {
        return
      }

      this.mqtt.publish(`${applianceId}/state`, JSON.stringify(combinedState))

      // Update cache with the combined state so comparisons after the command delay work correctly
      cache.set(cacheKey, combinedState)

      return response.data
    } catch (error) {
      logger.error(`Error sending command: ${formatAxiosError(error)}`)
    }
  }
}

export default ElectroluxClient

import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import axios, { AxiosInstance } from 'axios'
import { cache } from './cache'
import config, { Tokens } from './config'
import createLogger from './logger'
import iMqtt from './mqtt'
import { Appliance, ApplianceInfo, ApplianceStub, SanitizedState } from './types'
import { initializeHelpers } from './utils'

const logger = createLogger('electrolux')
const baseUrl = 'https://api.developer.electrolux.one'


function formatAxiosError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const statusText = error.response?.statusText
    const method = error.config?.method?.toUpperCase()
    const url = error.config?.url
    const message = error.message

    let formatted = message
    if (status) {
      formatted += ` (${status}${statusText ? ' ' + statusText : ''})`
    }
    if (method && url) {
      // Extract just the path part for readability
      const urlPath = new URL(url).pathname
      formatted += ` [${method} ${urlPath}]`
    }

    // Add response data if available and not too large
    if (error.response?.data && typeof error.response.data === 'object') {
      const responseStr = JSON.stringify(error.response.data)
      if (responseStr.length < 200) {
        formatted += ` - ${responseStr}`
      }
    }

    return formatted
  }
  return String(error)
}

class ElectroluxClient {
  private client?: AxiosInstance
  private accessToken?: string = config.electrolux.accessToken
  private refreshToken?: string = config.electrolux.refreshToken
  private eat?: Date = config.electrolux.eat
  private iat?: Date = config.electrolux.iat
  private mqtt: iMqtt
  private utils

  public isLoggingIn = false
  public isLoggedIn = false
  public refreshInterval: number = config.electrolux.refreshInterval ?? 30

  constructor(mqtt: iMqtt) {
    this.mqtt = mqtt

    this.utils = initializeHelpers(this.mqtt)

    this.createApiClient()
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
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }

      if (this.isLoggedIn) {
        await this.ensureValidToken()
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
      throw new Error('Failed to retrieve X-CSRF token data')
    }
    const { xcsrfToken, csrfSecret } = tokenData
    logger.debug('CSRF token retrieved successfully')
    
    try {
      const body = {
        email: config.electrolux.username,
        password: config.electrolux.password,
        postAuthAction: 'authorization',
        params: {
          response_type: 'code',
          client_id: 'HeiOpenApi',
          redirect_uri: 'https://developer.electrolux.one/loggedin',
        },
        countryCode: config.electrolux.countryCode,
      }

      const headers = {
        headers: {
          'x-csrf-token': xcsrfToken,
          Cookie: `_csrfSecret=${csrfSecret}`,
        },
      }

      const response = await axios.post('https://api.account.electrolux.one/api/v1/password/login', body, headers)
      const code = response.data.redirectUrl.match(/code=([^&]*)/)?.[1]

      const tokenBody = {
        code,
        redirectUri: 'https://developer.electrolux.one/loggedin',
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
      setTimeout(async () => {
        await this.login()
      }, 1000 * 5) // Retry after 5 seconds
      return false
    }
  }

  private sanitizeToken = (token: string) => {
    return token.replace('s%3A', '')
  }

  private retainTokensForOutput = (tokens: Partial<Tokens>) => {
    return {
      ...tokens,
      accessToken: `${this.accessToken?.slice(0, 10)}...token length ${this.accessToken?.length}...${this.accessToken?.slice(-10)}`,
      refreshToken: `${this.refreshToken?.slice(0, 10)}...token length ${this.refreshToken?.length}...${this.refreshToken?.slice(-10)}`,
    }
  }

  private sanitizeStateToMqtt = (rawState: Appliance) => {
    const mode = rawState.properties.reported.mode?.toLowerCase()
    const fanSpeedSetting = rawState.properties.reported.fanSpeedSetting?.toLowerCase()
    const applianceData = rawState.properties.reported.applianceData

    const state = {
      applianceId: rawState.applianceId,
      status: rawState.status?.toLowerCase() as 'enabled' | 'disabled',
      applianceState: rawState.properties.reported.applianceState?.toLowerCase() as 'on' | 'off',
      mode: (mode === 'fanonly' ? 'fan_only' : mode) as 'cool' | 'heat' | 'fan_only' | 'dry' | 'auto',
      ambientTemperatureC: rawState.properties.reported.ambientTemperatureC,
      targetTemperatureC: rawState.properties.reported.targetTemperatureC,
      fanSpeedSetting: (fanSpeedSetting === 'middle' ? 'medium' : fanSpeedSetting) as
        | 'low'
        | 'medium'
        | 'high'
        | 'auto',
      verticalSwing: rawState.properties.reported.verticalSwing,

      ambientTemperatureF: rawState.properties.reported.ambientTemperatureF,
      applianceData: applianceData
        ? {
            elc: applianceData.elc,
            mac: applianceData.mac,
            pnc: applianceData.pnc,
            sn: applianceData.sn,
          }
        : null,
      capabilities: rawState.properties.reported.capabilities,
      compressorCoolingRuntime: rawState.properties.reported.compressorCoolingRuntime,
      compressorHeatingRuntime: rawState.properties.reported.compressorHeatingRuntime,
      compressorState: rawState.properties.reported.compressorState?.toLowerCase() as 'on' | 'off',
      connectionState: rawState.connectionState?.toLowerCase() as 'connected' | 'disconnected',
      dataModelVersion: rawState.properties.reported.dataModelVersion,
      deviceId: rawState.properties.reported.deviceId,
      evapDefrostState: rawState.properties.reported.evapDefrostState?.toLowerCase() as 'on' | 'off' | null,
      filterRuntime: rawState.properties.reported.filterRuntime,
      filterState: rawState.properties.reported.filterState?.toLowerCase() as 'clean' | 'dirty',
      fourWayValveState: rawState.properties.reported.fourWayValveState?.toLowerCase() as 'on' | 'off' | null,
      hepaFilterLifeTime: rawState.properties.reported.hepaFilterLifeTime,
      logE: rawState.properties.reported.logE,
      logW: rawState.properties.reported.logW,
      networkInterface: {
        linkQualityIndicator: rawState.properties.reported.networkInterface?.linkQualityIndicator?.toLowerCase() as
          | 'excellent'
          | 'good'
          | 'fair'
          | 'poor',
        rssi: rawState.properties.reported.networkInterface?.rssi,
      },
      schedulerMode: rawState.properties.reported.schedulerMode?.toLowerCase() as 'on' | 'off' | null,
      schedulerSession: rawState.properties.reported.schedulerSession?.toLowerCase() as 'on' | 'off' | null,
      sleepMode: rawState.properties.reported.sleepMode?.toLowerCase() as 'on' | 'off',
      startTime: rawState.properties.reported.startTime,
      stopTime: rawState.properties.reported.stopTime,
      tasks: rawState.properties.reported.tasks,
      temperatureRepresentation: rawState.properties.reported.temperatureRepresentation?.toLowerCase() as
        | 'celsius'
        | 'fahrenheit',
      TimeZoneDaylightRule: rawState.properties.reported.TimeZoneDaylightRule,
      TimeZoneStandardName: rawState.properties.reported.TimeZoneStandardName,
      totalRuntime: rawState.properties.reported.totalRuntime,
      uiLockMode: rawState.properties.reported.uiLockMode,
      upgradeState: rawState.properties.reported.upgradeState?.toLowerCase() as 'idle' | 'upgrading' | null,
      version: rawState.properties.reported.$version,
      VmNo_MCU: rawState.properties.reported.VmNo_MCU,
      VmNo_NIU: rawState.properties.reported.VmNo_NIU,
    } as SanitizedState

    return state
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

      // 6 hour
      if (timeLeft <= 1000 * 60 * 60 * 6) {
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
    } catch (error) {
      logger.error(`Error refreshing access token: ${formatAxiosError(error)}`)
      setTimeout(async () => {
        await this.refreshTokens()
      }, 1000 * 5) // Retry after 5 seconds
    }
  }

  public async getAppliances() {
    try {
      if (!this.client) {
        throw new Error('API client is not initialized')
      }
      const response = await this.client.get('/api/v1/appliances')
      logger.debug('Appliances:', response.data)
      return response.data satisfies ApplianceStub[]
    } catch (error) {
      logger.error(`Error getting appliances: ${formatAxiosError(error)}`)
    }
  }

  public async getApplianceInfo(applianceId: string) {
    try {
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

  public async getApplianceState(
    applianceId: string,
    callback?: (state: SanitizedState) => void,
  ): Promise<Appliance | undefined> {
    const cacheKey = cache.cacheKey(applianceId).state

    try {
      if (!this.client) {
        throw new Error('API client is not initialized')
      }
      const response = await this.client.get(`/api/v1/appliances/${applianceId}/state`)

      if (cache.matchByValue(cacheKey, response.data)) {
        return cache.get(cacheKey) as Appliance
      }

      const sanitizedState = this.sanitizeStateToMqtt(response.data)
      logger.debug('State changed, publishing to MQTT', response.data)
      this.mqtt.publish(`${applianceId}/state`, JSON.stringify(sanitizedState))

      if (callback) {
        callback(sanitizedState)
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

  public async sendApplianceCommand(applianceId: string, rawCommand: SanitizedState) {
    const cacheKey = cache.cacheKey(applianceId).state

    try {
      if (!this.client) {
        throw new Error('API client is not initialized')
      }

      const { mode, ...command } = rawCommand

      const executeCommand = mode?.toLowerCase() === 'off' ? 'OFF' : 'ON'

      const payload = {
        ...command,
        executeCommand,
        ...(executeCommand !== 'OFF' && mode ? { mode: mode?.toUpperCase() } : {}),
        ...(command?.fanSpeedSetting
          ? {
              fanSpeedSetting: ['medium', 'middle'].includes(command?.fanSpeedSetting?.toLowerCase())
                ? 'MIDDLE'
                : command?.fanSpeedSetting?.toUpperCase(),
            }
          : {}),
      }

      logger.info('Sending command to appliance:', applianceId, 'Command:', payload)

      const response = await this.client.put(`/api/v1/appliances/${applianceId}/command`, payload)
      logger.debug('Command response', response.status, response.data)
      const state = await this.getApplianceState(applianceId)
      if (!state) {
        logger.error('Failed to get appliance state after sending command')
        return
      }

      const sanitizedState = this.sanitizeStateToMqtt(state)

      const combinedState = {
        ...sanitizedState,
        ...payload,
        applianceState: executeCommand.toLowerCase(),
        ...(mode || sanitizedState?.mode
          ? {
              mode: this.utils.mapModes[
                (mode ?? sanitizedState?.mode)?.toUpperCase() as keyof typeof this.utils.mapModes
              ],
            }
          : {}),
        ...(command?.fanSpeedSetting ? { fanSpeedSetting: command.fanSpeedSetting } : {}),
      }

      if (cache.matchByValue(cacheKey, combinedState)) {
        return
      }

      this.mqtt.publish(`${applianceId}/state`, JSON.stringify(combinedState))
      return response.data
    } catch (error) {
      logger.error(`Error sending command: ${formatAxiosError(error)}`)
    }
  }
}

export default ElectroluxClient

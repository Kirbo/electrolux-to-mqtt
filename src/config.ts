import fs from 'node:fs'
import path from 'node:path'
import yaml from 'yaml'
import createLogger from './logger'

const logger = createLogger('config')

export interface AppConfig {
  mqtt: {
    url: string
    clientId?: string
    username: string
    password: string
    topicPrefix?: string
    retain?: boolean
    qos?: number
  }
  electrolux: {
    apiKey: string
    username: string
    password: string
    countryCode: string
    accessToken?: string
    refreshToken?: string
    eat?: Date
    iat?: Date
    refreshInterval?: number
  }
  homeAssistant: {
    autoDiscovery: boolean
  }
  logging?: {
    showChanges?: boolean
    ignoredKeys?: string[]
  }
}

export interface Tokens {
  accessToken: string
  expiresIn: number
  tokenType: string
  refreshToken: string
  scope: string
  eat: number
  iat: number
}

const configPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../config.yml')
const file = fs.readFileSync(configPath, 'utf8')
const config = yaml.parse(file) as AppConfig

let tokens: Partial<Tokens> = {}
try {
  const tokensPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../tokens.json')
  if (fs.existsSync(tokensPath)) {
    tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'))
    logger.debug('tokens.json loaded')
  }
} catch (error) {
  logger.error('Error reading tokens.json:', error)
}

export default {
  ...config,
  electrolux: {
    ...config.electrolux,
    ...tokens,
    eat: tokens.eat ? new Date(tokens.eat * 1000) : undefined,
    iat: tokens.iat ? new Date(tokens.iat * 1000) : undefined,
  },
}

import { LRU } from 'tiny-lru'
import config from './config.js'
import createLogger from './logger.js'

const logger = createLogger('cache')
const skipCacheLogging = config.logging?.skipCacheLogging ?? true

const maxItems = 1000
const defaultTtl = 1000 * 60 * 60 * 24 // 24 hours
const defaultResetTtl = true

type CacheKeys = {
  state: string
  autoDiscovery: string
}

export class Cache {
  private readonly lru: LRU<string>

  constructor(max = maxItems, ttl = defaultTtl, resetTtl = defaultResetTtl) {
    this.lru = new LRU<string>(max, ttl, resetTtl)
  }

  cacheKey(key: string): CacheKeys {
    return {
      state: `${key}:state`,
      autoDiscovery: `${key}:auto-discovery`,
    }
  }

  matchByValue(key: string, value: unknown): boolean {
    const cached = this.get(key)
    const match = JSON.stringify(value) === JSON.stringify(cached)
    if (match) {
      if (!skipCacheLogging) {
        logger.debug(`Key "${key}" value has not changed.`)
      }
      return true
    }

    this.set(key, value)
    return false
  }

  get(key: string): unknown {
    const value = this.lru.get(key)
    if (value === undefined) {
      return undefined
    }
    return JSON.parse(value) as unknown
  }

  set(key: string, value: unknown): this {
    const toStore = typeof value === 'string' ? value : JSON.stringify(value)
    this.lru.set(key, toStore)
    if (!skipCacheLogging) {
      logger.debug(`Set "${key}" value:`, value)
    }
    return this
  }

  has(key: string): boolean {
    return this.lru.has(key)
  }

  delete(key: string): this {
    this.lru.delete(key)
    return this
  }
}

export const cache = new Cache()

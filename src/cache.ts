import { LRU } from 'tiny-lru'
import { canonicalStringify } from './canonical-stringify.js'
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

  /**
   * Returns the cache key object for an appliance.
   *
   * @param key - The appliance ID.
   * @param capabilitiesHash - When provided, the autoDiscovery key embeds this
   *   hash so that capability changes automatically invalidate the cache entry.
   */
  cacheKey(key: string, capabilitiesHash?: string): CacheKeys {
    return {
      state: `${key}:state`,
      autoDiscovery: capabilitiesHash ? `${key}:auto-discovery:${capabilitiesHash}` : `${key}:auto-discovery`,
    }
  }

  /**
   * Returns true if the stored canonical form of the value matches the
   * incoming value — i.e. the value has not changed since last stored.
   *
   * Uses the LRU as the single store: if the key was evicted, `lru.get`
   * returns `undefined` and we treat that as a MISS, preventing stale
   * hashStore entries from causing false positives.
   */
  matchByValue(key: string, value: unknown): boolean {
    const incoming = canonicalStringify(value)
    const stored = this.lru.get(key)
    if (stored !== undefined && stored === incoming) {
      if (!skipCacheLogging) {
        logger.debug(`Key "${key}" value has not changed.`)
      }
      return true
    }

    this.lru.set(key, incoming)
    if (!skipCacheLogging) {
      logger.debug(`Set "${key}" value:`, value)
    }
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
    this.lru.set(key, canonicalStringify(value))
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

import { createHash } from 'node:crypto'
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

/**
 * Hash an arbitrary value for equality comparison.
 * Returns a 16-char hex prefix — sufficient for cache-equality use.
 * Non-cryptographic use: used only to compare two serialised values for
 * equality, not for security purposes. NOSONAR
 */
function hashOfValue(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex').slice(0, 16) // NOSONAR
}

export class Cache {
  private readonly lru: LRU<string>
  /** Stores value hashes keyed by cache key for O(1) equality check. */
  private readonly hashStore = new Map<string, string>()

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

  matchByValue(key: string, value: unknown): boolean {
    const incoming = hashOfValue(value)
    const stored = this.hashStore.get(key)
    if (stored === incoming) {
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
    const json = JSON.stringify(value)
    this.lru.set(key, json)
    this.hashStore.set(key, hashOfValue(value))
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
    this.hashStore.delete(key)
    return this
  }
}

export const cache = new Cache()

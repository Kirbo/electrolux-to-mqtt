import type { RedisLike } from '../src/app.js'

// Lightweight in-memory Redis fake that implements only the surface used by
// the telemetry backend (see RedisLike). It mirrors node-redis v5 semantics —
// notably that scanIterator yields an array of keys per SCAN batch, which is
// the regression that motivated adding tests here.
export class FakeRedis implements RedisLike {
  readonly store = new Map<string, string>()
  readonly ttls = new Map<string, number>()

  // Forces scanIterator to yield in multiple batches so tests cover the
  // multi-batch flattening path regardless of how many keys are stored.
  readonly scanBatchSize: number

  constructor(options: { scanBatchSize?: number } = {}) {
    this.scanBatchSize = options.scanBatchSize ?? 1000
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.store.get(key) ?? '0') + 1
    this.store.set(key, String(next))
    return next
  }

  async expire(key: string, seconds: number): Promise<0 | 1> {
    if (!this.store.has(key)) return 0
    this.ttls.set(key, seconds)
    return 1
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async set(key: string, value: string): Promise<string> {
    this.store.set(key, value)
    return 'OK'
  }

  async setEx(key: string, seconds: number, value: string): Promise<string> {
    this.store.set(key, value)
    this.ttls.set(key, seconds)
    return 'OK'
  }

  async *scanIterator(options: { MATCH?: string; COUNT?: number }): AsyncIterable<string[]> {
    const pattern = options.MATCH ? globToRegExp(options.MATCH) : null
    const matching = [...this.store.keys()].filter((k) => !pattern || pattern.test(k))
    const batchSize = Math.max(1, this.scanBatchSize)
    for (let i = 0; i < matching.length; i += batchSize) {
      yield matching.slice(i, i + batchSize)
    }
  }
}

function globToRegExp(glob: string): RegExp {
  // Escape regex metacharacters except '*', which we translate to '.*'
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

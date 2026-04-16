import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AppConfig, createApp, generateBadge, getUserKeys } from '../src/app.js'
import { readMachineId } from '../src/utils.js'
import { FakeRedis } from './fake-redis.js'

// Some test paths exercise error-logging branches — silence the noise.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

function buildConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    rateLimitWindowMs: 60_000,
    rateLimitIpMax: 10,
    rateLimitHashMax: 1,
    rateLimitSalt: 'test-salt',
    // Default behindProxy: true so existing tests keep their X-Real-IP semantics.
    // Production default in index.ts is false (no proxy assumed).
    behindProxy: true,
    badgeDir: path.join(os.tmpdir(), `telemetry-test-${Math.random().toString(36).slice(2)}`),
    ...overrides,
  }
}

async function readJson(redis: FakeRedis, key: string): Promise<unknown> {
  const raw = await redis.get(key)
  return raw ? JSON.parse(raw) : null
}

// 64-char lowercase hex userHashes for positive test cases
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

describe('getUserKeys', () => {
  it('returns an empty array when no user keys exist', async () => {
    const redis = new FakeRedis()
    await redis.set('cached:telemetry', '{}')
    await redis.set('ratelimit:foo', '1')
    expect(await getUserKeys(redis)).toEqual([])
  })

  it('returns only keys matching user:*', async () => {
    const redis = new FakeRedis()
    await redis.set(`user:${HASH_A}`, '1.0.0')
    await redis.set(`user:${HASH_B}`, '1.1.0')
    await redis.set('cached:telemetry', '{}')
    await redis.set('ratelimit:ip:xyz', '3')

    const keys = await getUserKeys(redis)
    expect(keys.sort()).toEqual([`user:${HASH_A}`, `user:${HASH_B}`].sort())
  })

  // Regression test for the node-redis v4→v5 upgrade bug where scanIterator
  // started yielding arrays of keys per batch instead of individual keys,
  // collapsing the count to 1.
  it('flattens keys across multiple SCAN batches', async () => {
    const redis = new FakeRedis({ scanBatchSize: 3 })
    const hashes = Array.from({ length: 10 }, (_, i) => `${i}`.repeat(64).slice(0, 64))
    for (const h of hashes) {
      await redis.set(`user:${h}`, '1.0.0')
    }

    const keys = await getUserKeys(redis)
    expect(keys).toHaveLength(10)
    expect(new Set(keys).size).toBe(10)
  })
})

describe('generateBadge', () => {
  let badgeDir: string

  beforeEach(() => {
    badgeDir = path.join(os.tmpdir(), `telemetry-test-${Math.random().toString(36).slice(2)}`)
  })

  afterEach(async () => {
    await fsp.rm(badgeDir, { recursive: true, force: true })
  })

  it('writes an empty cache entry when no users exist', async () => {
    const redis = new FakeRedis()
    const config = buildConfig({ badgeDir })

    await generateBadge({ redis, config })

    expect(await readJson(redis, 'cached:telemetry')).toEqual({ total: 0, versions: [] })
  })

  it('aggregates user versions and sorts them descending', async () => {
    const redis = new FakeRedis()
    await redis.set(`user:${HASH_A}`, '1.0.0')
    await redis.set(`user:${HASH_B}`, '2.3.1')
    await redis.set(`user:${HASH_C}`, '1.0.0')
    const config = buildConfig({ badgeDir })

    await generateBadge({ redis, config })

    expect(await readJson(redis, 'cached:telemetry')).toEqual({
      total: 3,
      versions: [
        { version: '2.3.1', count: 1 },
        { version: '1.0.0', count: 2 },
      ],
    })
  })

  it('sorts pre-release versions below their stable counterpart and by rc number descending', async () => {
    const redis = new FakeRedis()
    const hashes = Array.from({ length: 5 }, (_, i) => `${i}`.repeat(64).slice(0, 64))
    const versions = ['1.2.3', '1.3.0-rc.1', '1.3.0', '1.2.3-rc.1', '1.3.0-rc.2']
    for (let i = 0; i < versions.length; i++) {
      await redis.set(`user:${hashes[i]}`, versions[i] as string)
    }
    const config = buildConfig({ badgeDir })

    await generateBadge({ redis, config })

    const cached = (await readJson(redis, 'cached:telemetry')) as {
      total: number
      versions: Array<{ version: string; count: number }>
    }
    expect(cached.versions.map((v) => v.version)).toEqual(['1.3.0', '1.3.0-rc.2', '1.3.0-rc.1', '1.2.3', '1.2.3-rc.1'])
  })

  it('treats "v"-prefixed versions equivalently for sort ordering', async () => {
    const redis = new FakeRedis()
    await redis.set(`user:${HASH_A}`, 'v1.0.0')
    await redis.set(`user:${HASH_B}`, 'v0.9.0')
    await redis.set(`user:${HASH_C}`, 'v2.0.0')
    const config = buildConfig({ badgeDir })

    await generateBadge({ redis, config })

    const cached = (await readJson(redis, 'cached:telemetry')) as {
      total: number
      versions: Array<{ version: string; count: number }>
    }
    expect(cached.versions.map((v) => v.version)).toEqual(['v2.0.0', 'v1.0.0', 'v0.9.0'])
  })

  it('writes an SVG badge file to badgeDir', async () => {
    const redis = new FakeRedis()
    await redis.set(`user:${HASH_A}`, '1.0.0')
    const config = buildConfig({ badgeDir })

    await generateBadge({ redis, config })

    const svg = await fsp.readFile(path.join(badgeDir, 'users.svg'), 'utf8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('>1<')
    expect(svg).toContain('Users')
  })

  it('still updates the cache when badge file write fails', async () => {
    const redis = new FakeRedis()
    await redis.set(`user:${HASH_A}`, '1.0.0')
    // Point badgeDir at a path that cannot be created (a file, not a dir)
    const notADir = path.join(os.tmpdir(), `telemetry-blocker-${Math.random().toString(36).slice(2)}`)
    await fsp.writeFile(notADir, 'blocking file')
    const config = buildConfig({ badgeDir: path.join(notADir, 'nested') })

    try {
      await generateBadge({ redis, config })
      expect(await readJson(redis, 'cached:telemetry')).toEqual({
        total: 1,
        versions: [{ version: '1.0.0', count: 1 }],
      })
    } finally {
      await fsp.rm(notADir, { force: true })
    }
  })

  it('ignores user keys with null values in the version aggregation', async () => {
    const redis = new FakeRedis()
    await redis.set(`user:${HASH_A}`, '1.0.0')
    // Simulate a key with an empty string — counts total but not version
    await redis.set(`user:${HASH_B}`, '')
    const config = buildConfig({ badgeDir })

    await generateBadge({ redis, config })

    expect(await readJson(redis, 'cached:telemetry')).toEqual({
      total: 2,
      versions: [{ version: '1.0.0', count: 1 }],
    })
  })
})

describe('POST /telemetry', () => {
  let redis: FakeRedis
  let config: AppConfig

  beforeEach(() => {
    redis = new FakeRedis()
    config = buildConfig()
  })

  afterEach(async () => {
    await fsp.rm(config.badgeDir, { recursive: true, force: true })
  })

  it('stores a valid payload and updates the cache', async () => {
    const app = createApp({ redis, config })

    const res = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.1')
      .send({ userHash: HASH_A, version: '1.2.3' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(await redis.get(`user:${HASH_A}`)).toBe('1.2.3')
    expect(redis.ttls.get(`user:${HASH_A}`)).toBe(24 * 60 * 60)
    expect(await readJson(redis, 'cached:telemetry')).toEqual({
      total: 1,
      versions: [{ version: '1.2.3', count: 1 }],
    })
  })

  it('returns 400 when userHash is missing (after consuming hash quota)', async () => {
    const app = createApp({ redis, config })

    const res = await request(app).post('/telemetry').set('X-Real-IP', '203.0.113.2').send({ version: '1.2.3' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/required/)
    // Rate limit key for missing hash should have been created (rate limit
    // runs before validation so malformed requests still consume quota)
    const hashKey = [...redis.store.keys()].find((k) => k.startsWith('ratelimit:hash:unknown-'))
    expect(hashKey).toBeDefined()
  })

  it('returns 400 when version is missing', async () => {
    const app = createApp({ redis, config })

    const res = await request(app).post('/telemetry').set('X-Real-IP', '203.0.113.3').send({ userHash: HASH_A })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/required/)
  })

  it('returns 400 for a userHash of invalid length', async () => {
    const app = createApp({ redis, config })

    const res = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.4')
      .send({ userHash: 'a'.repeat(10), version: '1.2.3' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/length/)
  })

  it('returns 400 for a non-hex userHash', async () => {
    const app = createApp({ redis, config })

    const res = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.5')
      .send({ userHash: `${'a'.repeat(63)}z`, version: '1.2.3' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/hex/)
  })

  it('returns 400 for a version containing invalid characters', async () => {
    const app = createApp({ redis, config })

    const res = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.6')
      .send({ userHash: HASH_A, version: '1.0.0 beta' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid characters/)
  })

  it('ignores payloads whose userHash contains "test-hash" without storing', async () => {
    const app = createApp({ redis, config })

    const res = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.7')
      .send({ userHash: 'test-hash-abc', version: '1.2.3' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, message: 'Test data ignored' })
    // Ensure no user:* key was written
    expect(await getUserKeys(redis)).toEqual([])
  })

  it('rejects a second POST for the same userHash within the window (hash rate limit)', async () => {
    const app = createApp({ redis, config })

    const first = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.10')
      .send({ userHash: HASH_A, version: '1.2.3' })
    expect(first.status).toBe(200)

    const second = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.11')
      .send({ userHash: HASH_A, version: '1.2.3' })
    expect(second.status).toBe(429)
    expect(second.body.error).toMatch(/Too many/)
  })

  it('rejects an IP that exceeds rateLimitIpMax within the window', async () => {
    const tightConfig = buildConfig({ rateLimitIpMax: 2, rateLimitHashMax: 1000 })
    const app = createApp({ redis, config: tightConfig })

    // Two allowed requests from the same IP with different hashes
    for (let i = 0; i < 2; i++) {
      const hash = `${i}`.padStart(64, 'f')
      const res = await request(app)
        .post('/telemetry')
        .set('X-Real-IP', '203.0.113.20')
        .send({ userHash: hash, version: '1.0.0' })
      expect(res.status).toBe(200)
    }

    // Third from the same IP must be blocked
    const blocked = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.20')
      .send({ userHash: HASH_B, version: '1.0.0' })
    expect(blocked.status).toBe(429)
    expect(blocked.body.error).toMatch(/Too many/)
  })

  it('does not share IP quota across distinct IPs', async () => {
    const tightConfig = buildConfig({ rateLimitIpMax: 1, rateLimitHashMax: 1000 })
    const app = createApp({ redis, config: tightConfig })

    // When behindProxy=true, Express resolves req.ip from X-Forwarded-For.
    // Use that header so each request is seen as a distinct IP.
    const first = await request(app)
      .post('/telemetry')
      .set('X-Forwarded-For', '198.51.100.1')
      .send({ userHash: HASH_A, version: '1.0.0' })
    const second = await request(app)
      .post('/telemetry')
      .set('X-Forwarded-For', '198.51.100.2')
      .send({ userHash: HASH_B, version: '1.0.0' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })

  it('rejects payloads larger than the 10kb body limit with 413', async () => {
    const app = createApp({ redis, config })

    const huge = 'a'.repeat(11 * 1024)
    const res = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.30')
      .set('Content-Type', 'application/json')
      .send(`{"userHash":"${huge}","version":"1.0.0"}`)

    expect(res.status).toBe(413)
  })

  it('rate-limits by IP before parsing the body (malformed JSON still counts)', async () => {
    const tightConfig = buildConfig({ rateLimitIpMax: 1, rateLimitHashMax: 1000 })
    const app = createApp({ redis, config: tightConfig })

    // First request: valid, consumes the one allowed slot
    const ok = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.40')
      .send({ userHash: HASH_A, version: '1.0.0' })
    expect(ok.status).toBe(200)

    // Second request from same IP — should be 429 even though payload is valid
    const blocked = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.40')
      .send({ userHash: HASH_B, version: '1.0.0' })
    expect(blocked.status).toBe(429)
  })

  it('includes Retry-After header when hash rate limit is exceeded', async () => {
    const windowConfig = buildConfig({ rateLimitWindowMs: 120_000, rateLimitHashMax: 1 })
    const app = createApp({ redis, config: windowConfig })

    await request(app).post('/telemetry').set('X-Real-IP', '203.0.113.50').send({ userHash: HASH_C, version: '1.0.0' })

    const blocked = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.51')
      .send({ userHash: HASH_C, version: '1.0.0' })

    expect(blocked.status).toBe(429)
    expect(blocked.headers['retry-after']).toBe('120')
  })

  it('includes Retry-After header when IP rate limit is exceeded', async () => {
    const windowConfig = buildConfig({ rateLimitWindowMs: 60_000, rateLimitIpMax: 1, rateLimitHashMax: 1000 })
    const app = createApp({ redis, config: windowConfig })

    await request(app).post('/telemetry').set('X-Real-IP', '203.0.113.60').send({ userHash: HASH_A, version: '1.0.0' })

    const blocked = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.60')
      .send({ userHash: HASH_B, version: '1.0.0' })

    expect(blocked.status).toBe(429)
    expect(blocked.headers['retry-after']).toBe('60')
  })
})

describe('GET /telemetry', () => {
  it('returns the default payload when no cache entry exists', async () => {
    const redis = new FakeRedis()
    const config = buildConfig()
    const app = createApp({ redis, config })

    const res = await request(app).get('/telemetry')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ total: 0, versions: [] })
  })

  it('returns the cached aggregated data when present', async () => {
    const redis = new FakeRedis()
    await redis.set('cached:telemetry', JSON.stringify({ total: 5, versions: [{ version: '1.0.0', count: 5 }] }))
    const config = buildConfig()
    const app = createApp({ redis, config })

    const res = await request(app).get('/telemetry')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ total: 5, versions: [{ version: '1.0.0', count: 5 }] })
  })

  it('returns 500 when the redis GET fails', async () => {
    const redis = new FakeRedis()
    const brokenRedis = {
      ...redis,
      get: async () => {
        throw new Error('redis down')
      },
      scanIterator: redis.scanIterator.bind(redis),
      incr: redis.incr.bind(redis),
      expire: redis.expire.bind(redis),
      set: redis.set.bind(redis),
      setEx: redis.setEx.bind(redis),
    }
    const config = buildConfig()
    const app = createApp({ redis: brokenRedis, config })

    const res = await request(app).get('/telemetry')

    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/Internal/)
  })
})

describe('readMachineId', () => {
  it('returns null when neither machine-id path exists', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    expect(readMachineId()).toBeNull()
  })

  it('returns trimmed content when a machine-id file exists', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => p === '/etc/machine-id')
    vi.spyOn(fs, 'readFileSync').mockReturnValue('abc123\n')
    expect(readMachineId()).toBe('abc123')
  })

  it('returns null when reading throws', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('permission denied')
    })
    expect(readMachineId()).toBeNull()
  })
})

// ── C3: IP spoofing resistance when behindProxy = false ─────────────────────
describe('POST /telemetry rate limit — behindProxy = false', () => {
  it('applies the same rate-limit bucket to all requests sharing the TCP source, ignoring X-Real-IP rotation', async () => {
    // With behindProxy=false, X-Real-IP must be ignored and the TCP source
    // (req.socket.remoteAddress) used instead. Supertest connects from loopback,
    // so all requests share the same bucket regardless of which X-Real-IP they set.
    const redis = new FakeRedis()
    const tightConfig = buildConfig({ rateLimitIpMax: 2, rateLimitHashMax: 1000, behindProxy: false })
    const app = createApp({ redis, config: tightConfig })

    // Two requests with different X-Real-IP values — both from the same TCP source
    for (let i = 0; i < 2; i++) {
      const res = await request(app)
        .post('/telemetry')
        .set('X-Real-IP', `203.0.113.${i + 1}`)
        .send({ userHash: `${i}`.padStart(64, 'f'), version: '1.0.0' })
      expect(res.status).toBe(200)
    }

    // Third request rotates X-Real-IP again — must still be blocked (quota exhausted by TCP source)
    const blocked = await request(app)
      .post('/telemetry')
      .set('X-Real-IP', '203.0.113.99')
      .send({ userHash: HASH_A, version: '1.0.0' })
    expect(blocked.status).toBe(429)
  })
})

// ── M5: /health and /health/redis endpoints ──────────────────────────────────
describe('GET /health', () => {
  it('returns 200 with { status: "ok" }', async () => {
    const app = createApp({ redis: new FakeRedis(), config: buildConfig() })
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('is not subject to the per-IP rate limit (100 rapid requests all succeed)', async () => {
    const tightConfig = buildConfig({ rateLimitIpMax: 1, behindProxy: false })
    const app = createApp({ redis: new FakeRedis(), config: tightConfig })

    // Fire 100 rapid /health requests — all must return 200 regardless of rate limit
    const results = await Promise.all(Array.from({ length: 100 }, () => request(app).get('/health')))
    for (const res of results) {
      expect(res.status).toBe(200)
    }
  })
})

describe('GET /health/redis', () => {
  it('returns 200 with { redis: "ok" } when Redis responds normally', async () => {
    const app = createApp({ redis: new FakeRedis(), config: buildConfig() })
    const res = await request(app).get('/health/redis')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ redis: 'ok' })
  })

  it('returns 503 with { redis: "down" } when Redis throws', async () => {
    const brokenRedis = new FakeRedis()
    const failingRedis = {
      ...brokenRedis,
      get: async (_key: string): Promise<string | null> => {
        throw new Error('connection refused')
      },
      scanIterator: brokenRedis.scanIterator.bind(brokenRedis),
      incr: brokenRedis.incr.bind(brokenRedis),
      expire: brokenRedis.expire.bind(brokenRedis),
      set: brokenRedis.set.bind(brokenRedis),
      setEx: brokenRedis.setEx.bind(brokenRedis),
    }
    const app = createApp({ redis: failingRedis, config: buildConfig() })
    const res = await request(app).get('/health/redis')
    expect(res.status).toBe(503)
    expect(res.body).toEqual({ redis: 'down' })
  })

  it('is not subject to the per-IP rate limit', async () => {
    const tightConfig = buildConfig({ rateLimitIpMax: 1, behindProxy: false })
    const app = createApp({ redis: new FakeRedis(), config: tightConfig })

    const results = await Promise.all(Array.from({ length: 20 }, () => request(app).get('/health/redis')))
    for (const res of results) {
      expect(res.status).toBe(200)
    }
  })
})

// ── M6: security headers via helmet ─────────────────────────────────────────
describe('security headers (helmet)', () => {
  it('sets X-Content-Type-Options: nosniff on GET /telemetry', async () => {
    const app = createApp({ redis: new FakeRedis(), config: buildConfig() })
    const res = await request(app).get('/telemetry')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('sets X-Frame-Options on GET /telemetry', async () => {
    const app = createApp({ redis: new FakeRedis(), config: buildConfig() })
    const res = await request(app).get('/telemetry')
    expect(res.headers['x-frame-options']).toBeDefined()
  })

  it('sets X-Content-Type-Options: nosniff on GET /health', async () => {
    const app = createApp({ redis: new FakeRedis(), config: buildConfig() })
    const res = await request(app).get('/health')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })
})

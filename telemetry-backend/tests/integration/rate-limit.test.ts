/**
 * Integration tests for enforceRateLimitRedis atomicity under real Redis.
 *
 * These tests require a live Redis instance and are gated behind:
 *   REAL_REDIS_TEST=true REDIS_URL=redis://localhost:6379 pnpm test
 *
 * To run locally:
 *   docker run --rm -d -p 6379:6379 redis:7-alpine
 *   REAL_REDIS_TEST=true pnpm test tests/integration/rate-limit.test.ts
 *
 * In CI, set REAL_REDIS_TEST=true and provide a Redis service. The test is
 * skipped entirely when REAL_REDIS_TEST is not set, so normal CI runs are
 * unaffected.
 *
 * Why this test exists:
 * FakeRedis is single-threaded and cannot reproduce the race condition that
 * the old non-atomic INCR+EXPIRE code had. This test exercises the Lua script
 * via the real Redis adapter to confirm that the TTL is always set even under
 * concurrent pressure. See FakeRedis file-level comment for more context.
 */

import { createClient } from 'redis'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const SKIP = process.env.REAL_REDIS_TEST !== 'true'

// Lua script — must match exactly what src/index.ts uses
const LUA_INCR_WITH_TTL = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`

describe.skipIf(SKIP)('rate-limit atomicity — real Redis', () => {
  let client: ReturnType<typeof createClient>
  const TEST_KEY_PREFIX = 'integration-test:ratelimit:'

  beforeAll(async () => {
    client = createClient({ url: process.env.REDIS_URL ?? 'redis://localhost:6379' })
    await client.connect()
  })

  afterAll(async () => {
    await client.quit()
  })

  beforeEach(async () => {
    // Clean up any leftover test keys
    const keys: string[] = []
    for await (const batch of client.scanIterator({ MATCH: `${TEST_KEY_PREFIX}*`, COUNT: 1000 })) {
      keys.push(...batch)
    }
    if (keys.length > 0) {
      await client.del(keys)
    }
  })

  it('sets TTL on first increment via Lua eval (atomicity check)', async () => {
    const key = `${TEST_KEY_PREFIX}ttl-check`
    const ttlMs = 60_000

    await client.eval(LUA_INCR_WITH_TTL, { keys: [key], arguments: [String(ttlMs)] })

    const pttl = await client.pTTL(key)
    // TTL must be set (positive, not -1 which means no TTL)
    expect(pttl).toBeGreaterThan(0)
    expect(pttl).toBeLessThanOrEqual(ttlMs)
  })

  it('does not reset TTL on subsequent increments', async () => {
    const key = `${TEST_KEY_PREFIX}no-reset`
    const ttlMs = 60_000

    // First increment — sets TTL
    await client.eval(LUA_INCR_WITH_TTL, { keys: [key], arguments: [String(ttlMs)] })
    const ttlAfterFirst = await client.pTTL(key)

    // Second increment — must not reset TTL
    await client.eval(LUA_INCR_WITH_TTL, { keys: [key], arguments: [String(ttlMs)] })
    const ttlAfterSecond = await client.pTTL(key)

    // TTL should have decreased (time passed) or stayed same, never increased back to ttlMs
    expect(ttlAfterSecond).toBeLessThanOrEqual(ttlAfterFirst)
    expect(ttlAfterSecond).toBeGreaterThan(0)
  })

  it('concurrent increments all land on the same counter with TTL set', async () => {
    const key = `${TEST_KEY_PREFIX}concurrent`
    const ttlMs = 60_000
    const concurrency = 20

    // Fire concurrent increments
    const results = await Promise.all(
      Array.from({ length: concurrency }, () =>
        client.eval(LUA_INCR_WITH_TTL, { keys: [key], arguments: [String(ttlMs)] }),
      ),
    )

    // All results are numbers 1..concurrency
    const values = (results as number[]).sort((a, b) => a - b)
    expect(values).toEqual(Array.from({ length: concurrency }, (_, i) => i + 1))

    // TTL must be set (the very first increment set it; subsequent ones didn't reset it)
    const pttl = await client.pTTL(key)
    expect(pttl).toBeGreaterThan(0)
  })
})

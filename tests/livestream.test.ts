/**
 * tests/livestream.test.ts
 *
 * Unit tests for LivestreamClient (src/livestream.ts).
 * No real network: fetch is stubbed via vi.stubGlobal, timers via vi.useFakeTimers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ElectroluxClient } from '@/electrolux.js'
import { LivestreamClient } from '@/livestream.js'
import type { LivestreamConfig, StreamEvent } from '@/types.js'

// ---------------------------------------------------------------------------
// Logger mock — prevent pino output during tests; hoist debug spy for assertions
// ---------------------------------------------------------------------------
const loggerDebugSpy = vi.hoisted(() => vi.fn())

vi.mock('@/logger.js', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: loggerDebugSpy,
  })),
}))

// ---------------------------------------------------------------------------
// Stream helpers
// ---------------------------------------------------------------------------

const enc = new TextEncoder()

/**
 * Build a controllable ReadableStream<Uint8Array> whose caller can push
 * string chunks and/or close it programmatically.
 */
function makeStream(): {
  stream: ReadableStream<Uint8Array>
  push: (text: string) => void
  close: () => void
  error: (err: unknown) => void
} {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c
    },
  })
  return {
    stream,
    push: (text: string) => ctrl.enqueue(enc.encode(text)),
    close: () => ctrl.close(),
    error: (err: unknown) => ctrl.error(err),
  }
}

/**
 * Build a fake Response whose body is the provided stream and whose ok/status
 * fields match the given parameters.
 */
function makeResponse(stream: ReadableStream<Uint8Array>, opts: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    body: stream,
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// Mock client factory
// ---------------------------------------------------------------------------

const defaultConfig: LivestreamConfig = {
  url: 'https://livestream.example.com/events',
  appliances: [{ applianceId: 'appl-1', properties: ['mode'] }],
}

function makeMockClient(overrides?: {
  getLivestreamConfig?: () => Promise<LivestreamConfig | undefined>
  getStreamAuthHeaders?: () => { Authorization: string; 'x-api-key': string } | null
}): ElectroluxClient {
  return {
    getLivestreamConfig: overrides?.getLivestreamConfig ?? vi.fn(() => Promise.resolve(defaultConfig)),
    getStreamAuthHeaders:
      overrides?.getStreamAuthHeaders ?? vi.fn(() => ({ Authorization: 'Bearer tok', 'x-api-key': 'key' })),
    reseedApplianceState: vi.fn(),
  } as unknown as ElectroluxClient
}

// ---------------------------------------------------------------------------
// Helpers for progressing the event loop
// ---------------------------------------------------------------------------

/** Yield to the microtask queue several times so promises can settle. */
async function flushPromises(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve()
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LivestreamClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // -------------------------------------------------------------------------
  // Basic event dispatch
  // -------------------------------------------------------------------------

  describe('single data: line → one onEvent call', () => {
    it('dispatches the parsed event and advances lastEventAt', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, {
        reconnectBaseMs: 100,
        reconnectMaxMs: 200,
      })

      const events: StreamEvent[] = []
      ls.onEvent((e) => events.push(e))

      ls.start()
      await flushPromises()

      const before = ls.lastEventAt()
      s.push('data: {"applianceId":"appl-1","property":"mode","value":"cool"}\n')
      await flushPromises()

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ applianceId: 'appl-1', property: 'mode', value: 'cool' })
      expect(ls.lastEventAt()).toBeGreaterThan(before)

      await ls[Symbol.asyncDispose]()
    })
  })

  describe('one chunk with multiple data: lines', () => {
    it('dispatches multiple events in order', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      const events: StreamEvent[] = []
      ls.onEvent((e) => events.push(e))

      ls.start()
      await flushPromises()

      s.push(
        'data: {"applianceId":"appl-1","property":"mode","value":"cool"}\n' +
          'data: {"applianceId":"appl-1","property":"targetTemperatureC","value":22}\n',
      )
      await flushPromises()

      expect(events).toHaveLength(2)
      expect(events[0]?.property).toBe('mode')
      expect(events[1]?.property).toBe('targetTemperatureC')

      await ls[Symbol.asyncDispose]()
    })
  })

  describe('data: JSON split across two chunks', () => {
    it('buffers the partial line and dispatches exactly one event once complete', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      const events: StreamEvent[] = []
      ls.onEvent((e) => events.push(e))

      ls.start()
      await flushPromises()

      // First chunk: partial line, no newline yet
      s.push('data: {"applianceId":"appl-1","property":"mode"')
      await flushPromises()
      expect(events).toHaveLength(0)

      // Second chunk: rest of the line + newline
      s.push(',"value":"heat"}\n')
      await flushPromises()

      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ applianceId: 'appl-1', property: 'mode', value: 'heat' })

      await ls[Symbol.asyncDispose]()
    })
  })

  describe('comment and blank lines', () => {
    it('ignores SSE comment lines and blank lines — no events emitted', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      const events: StreamEvent[] = []
      ls.onEvent((e) => events.push(e))

      ls.start()
      await flushPromises()

      s.push(': keep-alive\n\n: heartbeat\n\n')
      await flushPromises()

      expect(events).toHaveLength(0)

      await ls[Symbol.asyncDispose]()
    })
  })

  // -------------------------------------------------------------------------
  // onReconnect hooks
  // -------------------------------------------------------------------------

  describe('onReconnect hooks', () => {
    it('fires reconnect hooks after a successful connect, before any event', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      const order: string[] = []
      ls.onReconnect(() => void order.push('reconnect'))
      ls.onEvent(() => void order.push('event'))

      ls.start()
      await flushPromises()

      // Push a data event
      s.push('data: {"applianceId":"appl-1","property":"mode","value":"cool"}\n')
      await flushPromises()

      expect(order[0]).toBe('reconnect')
      expect(order[1]).toBe('event')
    })

    it('fires multiple onReconnect hooks in registration order', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      const calls: number[] = []
      ls.onReconnect(() => void calls.push(1))
      ls.onReconnect(() => void calls.push(2))

      ls.start()
      await flushPromises()

      expect(calls).toEqual([1, 2])

      await ls[Symbol.asyncDispose]()
    })
  })

  // -------------------------------------------------------------------------
  // Stream end → reconnect with backoff
  // -------------------------------------------------------------------------

  describe('stream end → reconnect', () => {
    it('reconnects after stream ends; with undefined config first, waits backoff then reconnects', async () => {
      const s1 = makeStream()
      const s2 = makeStream()

      let fetchCallCount = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          fetchCallCount++
          return Promise.resolve(makeResponse(fetchCallCount === 1 ? s1.stream : s2.stream))
        }),
      )

      let configCallCount = 0
      const client = makeMockClient({
        getLivestreamConfig: vi.fn(async () => {
          configCallCount++
          if (configCallCount === 1) return defaultConfig // initial connect
          if (configCallCount === 2) return undefined // force backoff
          return defaultConfig // second reconnect succeeds
        }),
      })

      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 500 })
      const events: StreamEvent[] = []
      ls.onEvent((e) => events.push(e))

      ls.start()
      await flushPromises()
      expect(fetchCallCount).toBe(1)

      // End the first stream → triggers reconnect loop
      s1.close()
      await flushPromises()

      // configCallCount is now 2 (undefined returned) → backoff
      // Advance fake timers to let the backoff sleep resolve
      await vi.advanceTimersByTimeAsync(200)
      await flushPromises()

      // configCallCount 3 (valid) → fetch called again
      expect(fetchCallCount).toBeGreaterThanOrEqual(2)

      await ls[Symbol.asyncDispose]()
    })

    it('backoff delay grows across consecutive failures and is capped', async () => {
      // getLivestreamConfig always returns undefined → only backoff sleeps
      const client = makeMockClient({
        getLivestreamConfig: vi.fn(async () => undefined),
      })

      // Track setTimeout calls made by the backoff sleep
      const sleepDelays: number[] = []
      const originalSetTimeout = globalThis.setTimeout
      vi.stubGlobal(
        'setTimeout',
        vi.fn((fn: () => void, ms?: number) => {
          if (ms !== undefined && ms > 0) sleepDelays.push(ms)
          // Use the fake-timer setTimeout so vi.advanceTimersByTimeAsync works
          return originalSetTimeout(fn, ms)
        }),
      )

      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 400 })
      ls.start()
      await flushPromises()

      // Each advance triggers the next backoff
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(500)
        await flushPromises()
      }

      await ls[Symbol.asyncDispose]()

      // Filter to only the backoff delays (exclude tiny internal ms values)
      const backoffDelays = sleepDelays.filter((d) => d >= 50)
      // Must have recorded at least a few backoff sleeps
      expect(backoffDelays.length).toBeGreaterThanOrEqual(3)
      // All delays must be capped at reconnectMaxMs (400)
      for (const d of backoffDelays) {
        expect(d).toBeLessThanOrEqual(400)
      }
      // After several retries, at least one delay should have grown above reconnectBaseMs (100)
      // — proving exponential growth, not just repeated base-delay jitter.
      // (computeBackoffDelay applies jitter so individual values aren't strictly monotone.)
      expect(backoffDelays.some((d) => d > 100)).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Idle watchdog
  // -------------------------------------------------------------------------

  describe('idle watchdog', () => {
    it('aborts the connection when no chunk arrives within idleTimeoutMs and reconnects', async () => {
      const s1 = makeStream()
      const s2 = makeStream()

      let fetchCount = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          fetchCount++
          return Promise.resolve(makeResponse(fetchCount === 1 ? s1.stream : s2.stream))
        }),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, {
        idleTimeoutMs: 500,
        reconnectBaseMs: 100,
        reconnectMaxMs: 200,
      })

      ls.start()
      await flushPromises()
      expect(fetchCount).toBe(1)

      // Advance past the idle timeout without pushing any data
      await vi.advanceTimersByTimeAsync(600)
      await flushPromises()

      // Should have reconnected
      expect(fetchCount).toBeGreaterThanOrEqual(2)

      await ls[Symbol.asyncDispose]()
    })
  })

  // -------------------------------------------------------------------------
  // stop() / asyncDispose
  // -------------------------------------------------------------------------

  describe('stop() and Symbol.asyncDispose', () => {
    it('stop() aborts the stream and the loop does NOT reconnect afterward', async () => {
      const s = makeStream()
      const getLivestreamConfig = vi.fn(async () => defaultConfig)
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient({ getLivestreamConfig })
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      ls.start()
      await flushPromises()

      const callsBefore = getLivestreamConfig.mock.calls.length

      ls.stop()
      await flushPromises()

      // Advance timers — loop must not re-enter
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()

      expect(getLivestreamConfig.mock.calls.length).toBe(callsBefore)
    })

    it('Symbol.asyncDispose awaits loop settlement', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      ls.start()
      await flushPromises()

      // Should resolve without hanging
      await ls[Symbol.asyncDispose]()
    })
  })

  // -------------------------------------------------------------------------
  // Idempotent start()
  // -------------------------------------------------------------------------

  describe('start() is idempotent', () => {
    it('calling start() twice while running does not create a second loop', async () => {
      const s = makeStream()
      const getLivestreamConfig = vi.fn(async () => defaultConfig)
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient({ getLivestreamConfig })
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      ls.start()
      ls.start() // second call must be a no-op
      await flushPromises()

      // getLivestreamConfig should only have been called once despite two start() calls
      expect(getLivestreamConfig.mock.calls.length).toBe(1)

      await ls[Symbol.asyncDispose]()
    })
  })

  // -------------------------------------------------------------------------
  // isStreamConnected()
  // -------------------------------------------------------------------------

  describe('isStreamConnected()', () => {
    it('returns true while stream body is being consumed and false after stop', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      ls.start()
      await flushPromises()

      expect(ls.isStreamConnected()).toBe(true)

      await ls[Symbol.asyncDispose]()
      expect(ls.isStreamConnected()).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Throwing onEvent listener is caught
  // -------------------------------------------------------------------------

  describe('throwing onEvent listener', () => {
    it('does not stop the stream; subsequent events still dispatch', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      let badListenerCalled = false
      const goodEvents: StreamEvent[] = []

      ls.onEvent(() => {
        badListenerCalled = true
        throw new Error('listener explosion')
      })
      ls.onEvent((e) => goodEvents.push(e))

      ls.start()
      await flushPromises()

      s.push('data: {"applianceId":"appl-1","property":"mode","value":"cool"}\n')
      await flushPromises()
      s.push('data: {"applianceId":"appl-1","property":"targetTemperatureC","value":20}\n')
      await flushPromises()

      expect(badListenerCalled).toBe(true)
      // Both events should have reached the second (good) listener
      expect(goodEvents).toHaveLength(2)

      await ls[Symbol.asyncDispose]()
    })
  })

  // -------------------------------------------------------------------------
  // getStreamAuthHeaders returning null → backoff
  // -------------------------------------------------------------------------

  describe('getStreamAuthHeaders() returns null', () => {
    it('backs off and retries when auth headers are not available', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      let headerCallCount = 0
      const client = makeMockClient({
        getStreamAuthHeaders: vi.fn(() => {
          headerCallCount++
          if (headerCallCount <= 2) return null
          return { Authorization: 'Bearer tok', 'x-api-key': 'key' }
        }),
      })

      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })
      ls.start()
      await flushPromises()

      // First two header calls return null → backoff
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()

      // Third call returns headers → fetch should have been called
      expect(headerCallCount).toBeGreaterThanOrEqual(3)

      await ls[Symbol.asyncDispose]()
    })
  })

  // -------------------------------------------------------------------------
  // refreshSubscription()
  // -------------------------------------------------------------------------

  describe('refreshSubscription()', () => {
    it('aborts the in-flight connection and triggers reconnect without setting stopped', async () => {
      const s1 = makeStream()
      const s2 = makeStream()

      let fetchCount = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          fetchCount++
          return Promise.resolve(makeResponse(fetchCount === 1 ? s1.stream : s2.stream))
        }),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      ls.start()
      await flushPromises()
      expect(fetchCount).toBe(1)

      ls.refreshSubscription()
      await flushPromises()
      await vi.advanceTimersByTimeAsync(50)
      await flushPromises()

      // Should reconnect
      expect(fetchCount).toBeGreaterThanOrEqual(2)
      // Stopped flag must not be set — stream is still running
      expect(ls.isStreamConnected()).toBe(true)

      await ls[Symbol.asyncDispose]()
    })
  })

  // -------------------------------------------------------------------------
  // lastEventAt() initial value
  // -------------------------------------------------------------------------

  describe('lastEventAt()', () => {
    it('returns 0 before any event is received', async () => {
      const client = makeMockClient({
        getLivestreamConfig: vi.fn(async () => undefined),
      })
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })
      expect(ls.lastEventAt()).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // Non-ok HTTP response → backoff
  // -------------------------------------------------------------------------

  describe('non-ok HTTP response', () => {
    it('backs off when fetch response is not ok', async () => {
      const s = makeStream()
      const getLivestreamConfig = vi.fn(async () => defaultConfig)
      let fetchCount = 0

      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          fetchCount++
          return Promise.resolve(
            fetchCount === 1 ? makeResponse(s.stream, { ok: false, status: 401 }) : makeResponse(s.stream),
          )
        }),
      )

      const client = makeMockClient({ getLivestreamConfig })
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      ls.start()
      await flushPromises()

      // After the 401, the loop should enter backoff
      await vi.advanceTimersByTimeAsync(300)
      await flushPromises()

      // getLivestreamConfig called again after backoff
      expect(getLivestreamConfig.mock.calls.length).toBeGreaterThanOrEqual(2)

      await ls[Symbol.asyncDispose]()
    })
  })

  // -------------------------------------------------------------------------
  // Diagnostic debug logging
  // -------------------------------------------------------------------------

  describe('debug logging — connect', () => {
    it('logs a debug message with origin+pathname (no query string) when the stream connects', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      // Use a URL with a query-string auth token to verify it is stripped
      const cfgWithToken: LivestreamConfig = {
        url: 'https://livestream.example.com/events?token=secret123',
        appliances: [{ applianceId: 'appl-1', properties: ['mode'] }],
      }
      const client = makeMockClient({
        getLivestreamConfig: vi.fn(() => Promise.resolve(cfgWithToken)),
      })
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })

      loggerDebugSpy.mockClear()
      ls.start()
      await flushPromises()

      // Must have logged a connect message — must not include the token
      const debugCalls = loggerDebugSpy.mock.calls
      const connectCall = debugCalls.find(
        (args: unknown[]) => typeof args[1] === 'string' && args[1].toLowerCase().includes('connect'),
      )
      expect(connectCall).toBeDefined()
      // The logged object must include the URL without the query string
      const loggedObj = connectCall?.[0] as Record<string, unknown>
      expect(typeof loggedObj?.url).toBe('string')
      expect(loggedObj?.url).not.toContain('secret123')
      expect(loggedObj?.url).toContain('/events')

      await ls[Symbol.asyncDispose]()
    })
  })

  describe('debug logging — heartbeat/comment lines', () => {
    it('logs a debug message when a heartbeat/comment SSE line is received', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })
      ls.start()
      await flushPromises()

      loggerDebugSpy.mockClear()
      s.push(': keep-alive\n')
      await flushPromises()

      // At least one debug call should mention heartbeat/keepalive/comment
      const debugCalls = loggerDebugSpy.mock.calls as unknown[][]
      const heartbeatCall = debugCalls.find((args) =>
        typeof args[0] === 'string'
          ? args[0].toLowerCase().includes('heartbeat') || args[0].toLowerCase().includes('keep')
          : typeof args[1] === 'string' &&
            (args[1].toLowerCase().includes('heartbeat') || args[1].toLowerCase().includes('keep')),
      )
      expect(heartbeatCall).toBeDefined()

      await ls[Symbol.asyncDispose]()
    })
  })

  describe('debug logging — named event: line', () => {
    it('logs a debug message with the event name when an event: line arrives (e.g. event:ping)', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })
      ls.start()
      await flushPromises()

      loggerDebugSpy.mockClear()
      s.push('event: update\n')
      await flushPromises()

      const debugCalls = loggerDebugSpy.mock.calls as unknown[][]
      // Should log the event name via the named-event handler
      const namedEventCall = debugCalls.find((args) => {
        const obj = args[0]
        if (typeof obj === 'object' && obj !== null) {
          return JSON.stringify(obj).includes('update')
        }
        return false
      })
      expect(namedEventCall).toBeDefined()

      await ls[Symbol.asyncDispose]()
    })
  })

  describe('debug logging — unexpected (non-data:, non-event:) line', () => {
    it('logs a debug message with the line content when a truly unexpected line arrives', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })
      ls.start()
      await flushPromises()

      loggerDebugSpy.mockClear()
      s.push('id: 12345\n') // SSE id field — not data: or event: or comment
      await flushPromises()

      const debugCalls = loggerDebugSpy.mock.calls as unknown[][]
      const unexpectedCall = debugCalls.find((args) => {
        const obj = args[0]
        if (typeof obj === 'object' && obj !== null) {
          return JSON.stringify(obj).includes('id: 12345')
        }
        return typeof obj === 'string' && obj.includes('id: 12345')
      })
      expect(unexpectedCall).toBeDefined()

      await ls[Symbol.asyncDispose]()
    })
  })

  describe('debug logging — data: payload received', () => {
    it('logs a debug message with the raw payload string before parsing for each data: line', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })
      ls.start()
      await flushPromises()

      loggerDebugSpy.mockClear()
      const payload = '{"applianceId":"appl-1","property":"mode","value":"cool"}'
      s.push(`data: ${payload}\n`)
      await flushPromises()

      const debugCalls = loggerDebugSpy.mock.calls as unknown[][]
      // Must have a debug call containing the raw payload string
      const payloadCall = debugCalls.find((args) => {
        const obj = args[0]
        if (typeof obj === 'object' && obj !== null) {
          return (obj as Record<string, unknown>).payload === payload
        }
        return false
      })
      expect(payloadCall).toBeDefined()

      await ls[Symbol.asyncDispose]()
    })
  })

  describe('debug logging — parse failure (null return from parseStreamEventData)', () => {
    it('logs a debug message with the raw payload when parseStreamEventData returns null', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })
      ls.start()
      await flushPromises()

      loggerDebugSpy.mockClear()
      // Valid JSON but not a StreamEvent shape (no applianceId)
      const badPayload = '{"type":"heartbeat","sequence":42}'
      s.push(`data: ${badPayload}\n`)
      await flushPromises()

      const debugCalls = loggerDebugSpy.mock.calls as unknown[][]
      // Must have a debug call about parse failure that includes the raw payload
      const parseFailCall = debugCalls.find((args) => {
        const obj = args[0]
        const msg = typeof args[1] === 'string' ? args[1] : ''
        const hasPayload =
          typeof obj === 'object' && obj !== null && (obj as Record<string, unknown>).payload === badPayload
        const mentionsFailure = msg.toLowerCase().includes('parse') || msg.toLowerCase().includes('did not')
        return hasPayload && mentionsFailure
      })
      expect(parseFailCall).toBeDefined()

      await ls[Symbol.asyncDispose]()
    })

    it('logs parse failure debug message when data: line contains malformed JSON', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })
      ls.start()
      await flushPromises()

      loggerDebugSpy.mockClear()
      const malformed = 'not-valid-json'
      s.push(`data: ${malformed}\n`)
      await flushPromises()

      const debugCalls = loggerDebugSpy.mock.calls as unknown[][]
      const parseFailCall = debugCalls.find((args) => {
        const obj = args[0]
        return typeof obj === 'object' && obj !== null && (obj as Record<string, unknown>).payload === malformed
      })
      expect(parseFailCall).toBeDefined()

      await ls[Symbol.asyncDispose]()
    })
  })

  describe('debug logging — successful event dispatch', () => {
    it('logs a debug message with applianceId and property when a valid StreamEvent is dispatched', async () => {
      const s = makeStream()
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(makeResponse(s.stream))),
      )

      const client = makeMockClient()
      const ls = new LivestreamClient(client, { reconnectBaseMs: 100, reconnectMaxMs: 200 })
      ls.start()
      await flushPromises()

      loggerDebugSpy.mockClear()
      s.push('data: {"applianceId":"appl-1","property":"mode","value":"heat"}\n')
      await flushPromises()

      const debugCalls = loggerDebugSpy.mock.calls as unknown[][]
      // Must have a debug call containing applianceId and property from the event
      const dispatchCall = debugCalls.find((args) => {
        const obj = args[0]
        if (typeof obj === 'object' && obj !== null) {
          const o = obj as Record<string, unknown>
          return o.applianceId === 'appl-1' && o.property === 'mode'
        }
        return false
      })
      expect(dispatchCall).toBeDefined()

      await ls[Symbol.asyncDispose]()
    })
  })
})

---
name: project-livestream-sse-transport
description: Key design patterns for testing LivestreamClient's detached async loop with vi.useFakeTimers
metadata:
  type: project
---

`src/livestream.ts` — `LivestreamClient implements AsyncDisposable`. Phase 3 of the SSE migration.

**Detached loop testability:** `start()` saves `this.loopSettled = this.runLoop()` (detached, not awaited). `Symbol.asyncDispose` awaits `loopSettled` — tests can drive to completion via `await ls[Symbol.asyncDispose]()`.

**AbortController + reader race:** `fetch()` is called with `signal: this.abort.signal`, but by the time the stream is being consumed, aborting the signal does NOT automatically unblock `reader.read()`. Fix: `signalToPromise(signal)` creates a Promise that resolves to `null` when the signal fires; `consumeStream` does `Promise.race([reader.read(), abortPromise])` — checks `result === null` to detect abort and break cleanly without throwing.

**Abortable backoff sleep:** `wakeBackoff: (() => void) | null`. The `backoff()` method sets `this.wakeBackoff = resolve` inside the sleep promise. `stop()` and `refreshSubscription()` both call `this.wakeBackoff?.()` to unblock early.

**refreshSubscription vs stop:** `refreshRequested` flag distinguishes the two abort reasons inside the AbortError catch block. When aborted but not stopped, `consumeStream` returns normally (via abortPromise) and the while loop continues — no catch is needed for the normal-exit path.

**Test mock style:** `as unknown as ElectroluxClient` — matches orchestrator.test.ts pattern. `vi.useFakeTimers()` in `beforeEach`, `vi.useRealTimers()` in `afterEach`. `flushPromises(rounds)` — loop of `await Promise.resolve()` to drain microtask queue between fake-timer advances.

**Backoff jitter caveat:** `computeBackoffDelay` applies jitter so individual delay samples are NOT monotone. Test for cap enforcement + growth presence (some delay > base), not strict ordering.

**Why:** Phase 4 wires this into Orchestrator. Phase 3 is purely additive — build stays green.

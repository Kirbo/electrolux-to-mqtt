import type { ElectroluxClient } from './electrolux.js'
import { computeBackoffDelay } from './electrolux.js'
import { parseStreamEventData } from './livestream-events.js'
import createLogger from './logger.js'
import type { StreamEvent } from './types.js'

const logger = createLogger('livestream')

// Module-level defaults — Phase 4 will pass config-derived values via LivestreamOptions
const LIVESTREAM_IDLE_TIMEOUT_MS = 120_000 // 2 minutes with no SSE data triggers reconnect
const LIVESTREAM_RECONNECT_BASE_DELAY_MS = 5_000 // First backoff window
const LIVESTREAM_RECONNECT_MAX_DELAY_MS = 300_000 // Backoff cap: 5 minutes

export interface LivestreamOptions {
  idleTimeoutMs?: number
  reconnectBaseMs?: number
  reconnectMaxMs?: number
}

export class LivestreamClient implements AsyncDisposable {
  private readonly client: ElectroluxClient
  private readonly idleTimeoutMs: number
  private readonly reconnectBaseMs: number
  private readonly reconnectMaxMs: number

  private readonly reconnectHooks: Array<() => Promise<void> | void> = []
  private readonly eventHooks: Array<(event: StreamEvent) => void> = []

  private stopped = false
  private running = false
  private connected = false
  private _lastEventAt = 0

  // In-flight SSE connection abort controller
  private abort: AbortController | null = null
  // Set when refreshSubscription() aborts the current connection (not a stop)
  private refreshRequested = false
  // Promise that resolves when runLoop exits — used by asyncDispose
  private loopSettled: Promise<void> = Promise.resolve()
  // Resolves the abortable backoff sleep early when stop() is called
  private wakeBackoff: (() => void) | null = null
  // Active watchdog timeout handle
  private watchdogHandle: ReturnType<typeof setTimeout> | null = null

  constructor(client: ElectroluxClient, options?: LivestreamOptions) {
    this.client = client
    this.idleTimeoutMs = options?.idleTimeoutMs ?? LIVESTREAM_IDLE_TIMEOUT_MS
    this.reconnectBaseMs = options?.reconnectBaseMs ?? LIVESTREAM_RECONNECT_BASE_DELAY_MS
    this.reconnectMaxMs = options?.reconnectMaxMs ?? LIVESTREAM_RECONNECT_MAX_DELAY_MS
  }

  // ---------------------------------------------------------------------------
  // Public registration API
  // ---------------------------------------------------------------------------

  public onReconnect(cb: () => Promise<void> | void): void {
    this.reconnectHooks.push(cb)
  }

  public onEvent(cb: (event: StreamEvent) => void): void {
    this.eventHooks.push(cb)
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Kick off the connection loop detached. Idempotent — second call while running is a no-op. */
  public start(): void {
    if (this.running) return
    this.running = true
    this.stopped = false
    this.loopSettled = this.runLoop()
  }

  /** Set the stopped flag, abort any in-flight connection, and clear the idle watchdog. */
  public stop(): void {
    this.stopped = true
    this.clearWatchdog()
    this.abort?.abort()
    this.wakeBackoff?.()
  }

  /** Abort the current connection so the loop re-fetches config and reconnects.
   *  Does NOT set the stopped flag. */
  public refreshSubscription(): void {
    this.refreshRequested = true
    this.abort?.abort()
    this.wakeBackoff?.()
  }

  public isStreamConnected(): boolean {
    return this.connected
  }

  public lastEventAt(): number {
    return this._lastEventAt
  }

  public async [Symbol.asyncDispose](): Promise<void> {
    this.stop()
    await this.loopSettled
    this.running = false
  }

  // ---------------------------------------------------------------------------
  // Connection loop (decomposed to stay under cognitive complexity 15)
  // ---------------------------------------------------------------------------

  private async runLoop(): Promise<void> {
    let attempt = 0

    while (!this.stopped) {
      try {
        const cfg = await this.client.getLivestreamConfig()
        if (!cfg) {
          await this.backoff(attempt++)
          continue
        }

        const headers = this.client.getStreamAuthHeaders()
        if (!headers) {
          await this.backoff(attempt++)
          continue
        }

        this.abort = new AbortController()
        const res = await fetch(cfg.url, { headers, signal: this.abort.signal })

        if (!res.ok || !res.body) {
          await this.backoff(attempt++)
          continue
        }

        attempt = 0
        this.connected = true
        await this.fireReconnectHooks()
        await this.consumeStream(res.body, this.abort.signal)
      } catch (err) {
        if (this.stopped) break
        if (isAbortError(err)) {
          // Watchdog or refreshSubscription abort — reconnect immediately (no penalty)
          // unless this was a stop()-triggered abort (checked by the while condition)
          if (this.refreshRequested) {
            this.refreshRequested = false
          }
          continue
        }
        logger.warn({ err }, 'Livestream connection error — reconnecting with backoff')
        await this.backoff(attempt++)
      } finally {
        this.connected = false
        this.clearWatchdog()
      }
    }
  }

  /** Abortable exponential backoff sleep. Resolves early if stop() or refreshSubscription() fires. */
  private async backoff(attempt: number): Promise<void> {
    if (this.stopped) return
    const delay = computeBackoffDelay(attempt, this.reconnectBaseMs, this.reconnectMaxMs)
    await new Promise<void>((resolve) => {
      this.wakeBackoff = resolve
      setTimeout(() => resolve(), delay)
    })
    this.wakeBackoff = null
  }

  private async fireReconnectHooks(): Promise<void> {
    for (const hook of this.reconnectHooks) {
      try {
        await hook()
      } catch (err) {
        logger.error({ err }, 'onReconnect hook threw — ignoring')
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Stream consumption (decomposed to stay under cognitive complexity 15)
  // ---------------------------------------------------------------------------

  private async consumeStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<void> {
    const reader = body.pipeThrough(new TextDecoderStream()).getReader()
    // Resolves with null when the abort signal fires — races against reader.read()
    const abortPromise = signalToPromise(signal)
    let buffer = ''

    try {
      this.armWatchdog()

      while (true) {
        const result = await Promise.race([reader.read(), abortPromise])
        // abortPromise resolved (null) — leave the loop; runLoop will handle the abort
        if (result === null) break
        if (result.done) break

        this.armWatchdog()
        buffer += result.value
        buffer = this.processBuffer(buffer)
      }
    } finally {
      reader.cancel().catch(() => {
        // Suppress cancel errors — stream may already be closed/aborted
      })
    }
  }

  /**
   * Drain complete lines from the buffer, dispatch events, return the remaining partial line.
   * Extracted to keep consumeStream under the cognitive complexity limit.
   */
  private processBuffer(buffer: string): string {
    const lines = buffer.split('\n')
    // Last element is an incomplete line (or '' if buffer ends with \n)
    const remaining = lines.pop() ?? ''
    for (const line of lines) {
      this.dispatchLine(line)
    }
    return remaining
  }

  /** Parse and dispatch a single complete SSE line. */
  private dispatchLine(raw: string): void {
    const line = raw.trim()
    if (line === '' || line.startsWith(':')) return

    if (!line.startsWith('data:')) return

    const payload = line.slice('data:'.length).trim()
    const event = parseStreamEventData(payload)
    if (!event) return

    this._lastEventAt = Date.now()
    for (const hook of this.eventHooks) {
      try {
        hook(event)
      } catch (err) {
        logger.error({ err }, 'onEvent listener threw — ignoring')
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Idle watchdog
  // ---------------------------------------------------------------------------

  private armWatchdog(): void {
    this.clearWatchdog()
    this.watchdogHandle = setTimeout(() => {
      logger.warn('Livestream idle timeout exceeded — aborting connection to force reconnect')
      this.abort?.abort()
    }, this.idleTimeoutMs)
  }

  private clearWatchdog(): void {
    if (this.watchdogHandle !== null) {
      clearTimeout(this.watchdogHandle)
      this.watchdogHandle = null
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

/**
 * Returns a Promise that resolves to null when the given AbortSignal fires.
 * Used to race against reader.read() so consumeStream exits promptly on abort.
 */
function signalToPromise(signal: AbortSignal): Promise<null> {
  return new Promise<null>((resolve) => {
    if (signal.aborted) {
      resolve(null)
      return
    }
    signal.addEventListener('abort', () => resolve(null), { once: true })
  })
}

/**
 * End-to-End tests for the Electrolux SSE Livestream
 *
 * These tests connect to the REAL Electrolux SSE livestream endpoint to:
 * 1. Confirm the `{ url, appliances }` config shape returned by getLivestreamConfig()
 * 2. Capture a sample of live SSE events so the exact wire values of
 *    connectionState/connectivityState events can be observed and used to
 *    finalize `coerceConnectionState` in src/livestream-events.ts
 *
 * HOW TO RUN:
 * - Ensure config.yml (or .env) has valid ELECTROLUX_API_KEY + credentials
 * - Run: pnpm test:e2e
 *   OR:  E2E_TEST=true pnpm vitest run tests/e2e/livestream.e2e.test.ts
 *
 * IMPORTANT:
 * - These tests are SKIPPED by default in CI/normal test runs
 * - They open a real SSE connection to the Electrolux livestream API
 * - Test 2 runs for up to 60 s to capture events; total timeout is 90 s
 * - After running, inspect tests/e2e/snapshots/livestream-sample.jsonl for
 *   connectionState / connectivityState entries and finalize coerceConnectionState
 *
 * SNAPSHOTS:
 * - tests/e2e/snapshots/livestream-config.json  — getLivestreamConfig() response
 *   (stream URL query-string auth token is masked)
 * - tests/e2e/snapshots/livestream-sample.jsonl — one StreamEvent JSON per line
 *   (these are gitignored along with the rest of tests/e2e/snapshots/)
 */

import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { ElectroluxClient } from '@/electrolux.js'
import { LivestreamClient } from '@/livestream.js'
import createLogger from '@/logger.js'
import type { IMqtt } from '@/mqtt.js'
import type { LivestreamConfig, StreamEvent } from '@/types.js'

const log = createLogger('e2e:livestream')

const SNAPSHOT_DIR = path.resolve(process.cwd(), 'tests/e2e/snapshots')
const CAPTURE_WINDOW_MS = 60_000 // 60 s of real-stream capture
const TEST_TIMEOUT_MS = 90_000 // vitest per-test timeout (must exceed CAPTURE_WINDOW_MS)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function writeSnapshot(filePath: string, data: unknown) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
}

/**
 * Mask any auth token embedded in a URL's query string.
 * Targets common token/signature query-param names: token, access_token, signature, sig, auth.
 * The param name is preserved; only the value is replaced with "[REDACTED]".
 */
function maskUrlToken(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    // Not a valid absolute URL — return as-is (no token to mask)
    return rawUrl
  }
  const sensitiveParams = ['token', 'access_token', 'signature', 'sig', 'auth', 'key', 'apikey', 'api_key']
  for (const param of sensitiveParams) {
    if (url.searchParams.has(param)) {
      url.searchParams.set(param, '[REDACTED]')
    }
  }
  return url.toString()
}

// ---------------------------------------------------------------------------
// Gate: only runs under E2E_TEST=true
// ---------------------------------------------------------------------------

const isE2EEnabled = process.env.E2E_TEST === 'true'

describe.skipIf(!isE2EEnabled)('Electrolux Livestream - E2E Tests', () => {
  let client: ElectroluxClient

  // Minimal IMqtt stub — the E2E tests never publish; we only need the shape.
  const mockMqtt = {
    client: null,
    topicPrefix: 'test/',
    publish: () => {},
    subscribe: () => Promise.resolve(),
    isConnected: () => true,
    connect: async () => {},
    disconnect: async () => {},
    generateAutoDiscoveryConfig: () => {},
    resolveApplianceTopic: (applianceId: string) => `test/${applianceId}`,
    unsubscribe: () => {},
    publishInfo: () => {},
    autoDiscovery: () => {},
  } as unknown as IMqtt

  beforeAll(async () => {
    client = new ElectroluxClient(mockMqtt)
    await client.initialize()

    const loginSuccess = await client.login()
    if (!loginSuccess) {
      throw new Error('Failed to login to Electrolux API. Check credentials in config.yml or .env')
    }

    log.info('Successfully authenticated with Electrolux API')
  }, 30_000)

  // ---------------------------------------------------------------------------
  // Test 1 — config shape
  // ---------------------------------------------------------------------------

  it('getLivestreamConfig() returns a valid config and snapshots it', async () => {
    const cfg = await client.getLivestreamConfig()

    expect(cfg).toBeDefined()
    if (!cfg) throw new Error('getLivestreamConfig() returned undefined')

    // Structural assertions — these lock in the SDK-derived config shape
    expect(typeof cfg.url).toBe('string')
    expect(cfg.url.length).toBeGreaterThan(0)
    expect(Array.isArray(cfg.appliances)).toBe(true)

    for (const entry of cfg.appliances) {
      expect(typeof entry.applianceId).toBe('string')
      expect(entry.applianceId.length).toBeGreaterThan(0)
      expect(Array.isArray(entry.properties)).toBe(true)
    }

    log.info(`Livestream URL (raw): ${cfg.url}`)
    log.info(`Appliances in config: ${cfg.appliances.length}`)
    for (const entry of cfg.appliances) {
      log.info(`  ${entry.applianceId}: [${entry.properties.join(', ')}]`)
    }

    // Build a snapshot-safe copy: mask any auth token in the URL
    const snapshotConfig: LivestreamConfig = {
      url: maskUrlToken(cfg.url),
      appliances: cfg.appliances,
    }

    writeSnapshot(path.join(SNAPSHOT_DIR, 'livestream-config.json'), snapshotConfig)
    log.info('Saved tests/e2e/snapshots/livestream-config.json (stream URL token masked)')
  })

  // ---------------------------------------------------------------------------
  // Test 2 — live event capture
  // ---------------------------------------------------------------------------

  it(
    'captures live SSE events for a bounded window and snapshots them',
    async () => {
      const capturedEvents: StreamEvent[] = []
      const connectionStateValues: Array<{ property: string; value: unknown }> = []

      // Build the livestream client with a generous idle timeout so it stays connected
      // during the capture window even on quiet appliances.
      const stream = new LivestreamClient(client, {
        idleTimeoutMs: CAPTURE_WINDOW_MS + 10_000, // never watchdog-fire during the window
        reconnectBaseMs: 5_000,
        reconnectMaxMs: 30_000,
      })

      stream.onEvent((event) => {
        capturedEvents.push(event)

        // Surface connection-state events prominently for finalization of coerceConnectionState
        if (event.property === 'connectionState' || event.property === 'connectivityState') {
          connectionStateValues.push({ property: event.property, value: event.value })
          log.info(
            `[CAPTURE] connection-state event: property="${event.property}" value=${JSON.stringify(event.value)}`,
          )
        }
      })

      stream.start()

      // Run for the bounded capture window, then stop cleanly
      await new Promise<void>((resolve) => setTimeout(resolve, CAPTURE_WINDOW_MS))
      await stream[Symbol.asyncDispose]()

      log.info(`Capture window closed. Total events received: ${capturedEvents.length}`)

      if (connectionStateValues.length > 0) {
        log.info('--- connectionState / connectivityState wire values observed ---')
        for (const entry of connectionStateValues) {
          log.info(`  property="${entry.property}"  value=${JSON.stringify(entry.value)}`)
        }
        log.info('Use these to finalize coerceConnectionState in src/livestream-events.ts')
      } else {
        log.info('No connectionState/connectivityState events captured (appliance may be idle/stable)')
      }

      // Write captured events as newline-delimited JSON (one object per line)
      const jsonlPath = path.join(SNAPSHOT_DIR, 'livestream-sample.jsonl')
      ensureDir(SNAPSHOT_DIR)
      const lines = capturedEvents.map((e) => JSON.stringify(e)).join('\n')
      fs.writeFileSync(jsonlPath, lines.length > 0 ? `${lines}\n` : '', 'utf8')
      log.info(`Saved tests/e2e/snapshots/livestream-sample.jsonl (${capturedEvents.length} events)`)

      // The only hard assertion: the run completed without throwing.
      // We do NOT assert a minimum event count — an idle appliance may emit nothing.
      expect(capturedEvents.length).toBeGreaterThanOrEqual(0)
    },
    TEST_TIMEOUT_MS,
  )
})

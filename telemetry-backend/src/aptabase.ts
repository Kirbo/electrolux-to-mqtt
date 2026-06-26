import type { LegacyBody } from './validation.js'

export type AptabaseEvent = {
  timestamp: string
  sessionId: string
  eventName: 'version_check'
  systemProps: {
    appVersion: string
    isDebug: false
    sdkVersion: string
  }
  props: {
    channel: 'stable' | 'beta'
    source: 'legacy'
  }
}

export interface AptabaseForwarder {
  forward(event: AptabaseEvent, clientIp: string): Promise<void>
}

/** Returns true for CalVer beta (e.g. 2026.6.0b1) or SemVer pre-release (1.2.3-rc.1). */
function isPreReleaseVersion(version: string): boolean {
  return version.includes('-') || /\db\d+$/.test(version)
}

/**
 * Map a 64-hex userHash to a UUID-shaped sessionId.
 *
 * Aptabase's ingestion validates `sessionId` as a GUID and *silently drops* events
 * whose sessionId is not GUID-parseable (returns 200 but never writes the row). Legacy
 * bodies carry a 64-hex userHash, so the first 16 bytes are formatted as 8-4-4-4-12.
 * Deterministic — the same install always maps to the same sessionId.
 */
function userHashToSessionId(userHash: string): string {
  // validateLegacyBody guarantees 64 lowercase hex chars; 32 hex = the 16 bytes a UUID needs.
  const h = userHash.slice(0, 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/**
 * Build an Aptabase event from a validated legacy body.
 * @param body           - Validated legacy POST body.
 * @param serviceVersion - The service package version (for sdkVersion).
 */
export function buildAptabaseEvent(body: LegacyBody, serviceVersion: string): AptabaseEvent {
  const appVersion = body.version.replace(/^v/, '')
  const channel: 'stable' | 'beta' = body.channel ?? (isPreReleaseVersion(body.version) ? 'beta' : 'stable')

  return {
    timestamp: new Date().toISOString(),
    sessionId: userHashToSessionId(body.userHash),
    eventName: 'version_check',
    systemProps: {
      appVersion,
      isDebug: false,
      sdkVersion: `telemetry-backend@${serviceVersion}`,
    },
    props: {
      channel,
      source: 'legacy',
    },
  }
}

/** Read a response body for error logging, capped and never throwing. */
async function readErrorBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    // Body already consumed or stream errored — the status alone is enough to act on.
    return '<unreadable body>'
  }
}

/**
 * Create an AptabaseForwarder that POSTs events to the real Aptabase ingestion endpoint.
 *
 * Per-install counting: Aptabase derives the daily anonymous `user_id` from
 * `app_id + client IP + User-Agent`. All forwarded events share the backend's IP
 * (the proxy chain in front of Aptabase doesn't honor the X-Forwarded-For we send),
 * so a constant User-Agent would collapse every legacy bridge into one `user_id`.
 * We therefore embed the install's `sessionId` (deterministically derived from the
 * bridge's `userHash`) into the User-Agent so each install gets its own `user_id`.
 * X-Forwarded-For is still sent — if the chain is ever fixed to trust it, GeoIP is
 * restored too, but counting no longer depends on it.
 *
 * A non-2xx response throws (with the status + body) so the caller logs it instead of
 * silently dropping the event — a 401/400 from Aptabase would otherwise be invisible.
 *
 * @param fetchImpl Injectable for tests; defaults to the global fetch.
 */
export function createHttpForwarder(
  aptabaseHost: string,
  appKey: string,
  fetchImpl: typeof fetch = fetch,
): AptabaseForwarder {
  const url = `${aptabaseHost}/api/v0/events`
  const TIMEOUT_MS = 10_000

  return {
    async forward(event: AptabaseEvent, clientIp: string): Promise<void> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'App-Key': appKey,
            'Content-Type': 'application/json',
            'User-Agent': `electrolux-to-mqtt-legacy/${event.sessionId}`,
            'X-Forwarded-For': clientIp,
          },
          body: JSON.stringify([event]),
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(`Aptabase ingest returned ${res.status} ${res.statusText}: ${await readErrorBody(res)}`)
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

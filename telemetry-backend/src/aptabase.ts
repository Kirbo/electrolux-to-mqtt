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
 * Build an Aptabase event from a validated legacy body.
 * @param body           - Validated legacy POST body.
 * @param serviceVersion - The service package version (for sdkVersion).
 */
export function buildAptabaseEvent(body: LegacyBody, serviceVersion: string): AptabaseEvent {
  const appVersion = body.version.replace(/^v/, '')
  const channel: 'stable' | 'beta' = body.channel ?? (isPreReleaseVersion(body.version) ? 'beta' : 'stable')

  return {
    timestamp: new Date().toISOString(),
    sessionId: body.userHash,
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

/**
 * Create an AptabaseForwarder that POSTs events to the real Aptabase ingestion endpoint.
 *
 * The client IP is forwarded via X-Forwarded-For so Aptabase attributes the event
 * to the originating bridge install rather than the backend's IP. This is the CRITICAL
 * prerequisite for correct per-install counting — see README.md.
 */
export function createHttpForwarder(aptabaseHost: string, appKey: string): AptabaseForwarder {
  const url = `${aptabaseHost}/api/v0/events`
  const TIMEOUT_MS = 10_000

  return {
    async forward(event: AptabaseEvent, clientIp: string): Promise<void> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        await fetch(url, {
          method: 'POST',
          headers: {
            'App-Key': appKey,
            'Content-Type': 'application/json',
            'User-Agent': 'electrolux-to-mqtt-legacy',
            'X-Forwarded-For': clientIp,
          },
          body: JSON.stringify([event]),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

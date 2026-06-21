import type { Appliance, LivestreamConfig, StreamEvent } from './types.js'

/**
 * Runtime guard for StreamEvent.
 * Rejects missing/empty applianceId or missing property — the SDK skips such events.
 */
export function isStreamEvent(value: unknown): value is StreamEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const v = value as Record<string, unknown>
  return typeof v.applianceId === 'string' && v.applianceId !== '' && typeof v.property === 'string'
}

/**
 * Runtime guard for LivestreamConfig.
 * Validates url is a string and appliances is an array of {applianceId: string, properties: string[]}.
 */
export function isLivestreamConfig(value: unknown): value is LivestreamConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const v = value as Record<string, unknown>
  if (typeof v.url !== 'string') {
    return false
  }
  if (!Array.isArray(v.appliances)) {
    return false
  }
  return v.appliances.every(isLivestreamAppliance)
}

function isLivestreamAppliance(entry: unknown): entry is { applianceId: string; properties: string[] } {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return false
  }
  const e = entry as Record<string, unknown>
  return typeof e.applianceId === 'string' && Array.isArray(e.properties)
}

/**
 * Parse one SSE `data:` payload string into a StreamEvent.
 * Returns null on parse error or when the parsed value is not a valid StreamEvent.
 * Intentional null-return catch: this is a documented fallback — the transport layer logs failures.
 */
export function parseStreamEventData(data: string): StreamEvent | null {
  try {
    const parsed: unknown = JSON.parse(data)
    return isStreamEvent(parsed) ? parsed : null
  } catch {
    // JSON.parse failure — return null; caller logs if needed
    return null
  }
}

/**
 * Map an SSE wire value onto the raw Appliance connectionState enum.
 * Accepts exact 'Connected'/'Disconnected', case-insensitive matches, and boolean-ish values.
 * On any unknown input, returns `prior` unchanged.
 *
 * NOTE: The exact wire value from the Electrolux SSE stream is unconfirmed pending the
 * Phase-6 E2E capture. This is provisional; finalize after the snapshot test runs.
 */
export function coerceConnectionState(
  value: unknown,
  prior: Appliance['connectionState'],
): Appliance['connectionState'] {
  if (value === true) {
    return 'Connected'
  }
  if (value === false) {
    return 'Disconnected'
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (lower === 'connected') {
      return 'Connected'
    }
    if (lower === 'disconnected') {
      return 'Disconnected'
    }
  }
  return prior
}

/**
 * Return a plain-object view of `value` for safe mutation.
 * When `value` is a non-null, non-array object, return it cast to Record<string, unknown>.
 * Otherwise return a fresh empty object. This keeps the path-walker free of `any` or
 * unchecked non-null assertions under noUncheckedIndexedAccess.
 */
function asMutableRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

/**
 * Apply a single StreamEvent delta onto a cached Appliance, returning a new patched Appliance.
 * The input `cached` is never mutated — structuredClone is used as the first step.
 *
 * Special-case: property === "connectionState" or "connectivityState" sets the top-level
 * connectionState field and does NOT touch properties.reported.
 *
 * All other properties are treated as '/'-separated paths into properties.reported,
 * with intermediate objects created on demand.
 */
export function applyStreamEvent(cached: Appliance, event: StreamEvent): Appliance {
  const next = structuredClone(cached)

  if (event.property === 'connectionState' || event.property === 'connectivityState') {
    next.connectionState = coerceConnectionState(event.value, cached.connectionState)
    return next
  }

  const segments = event.property.split('/')
  // Walk into properties.reported as a mutable record
  const reported: Record<string, unknown> = asMutableRecord(next.properties.reported)

  if (segments.length === 1) {
    const key = segments[0]
    if (key !== undefined) {
      reported[key] = event.value
    }
  } else {
    // Multi-segment: walk/create intermediate objects, set leaf
    let cursor: Record<string, unknown> = reported
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]
      if (segment === undefined) {
        continue
      }
      cursor[segment] = asMutableRecord(cursor[segment])
      cursor = cursor[segment] as Record<string, unknown>
    }
    const leaf = segments[segments.length - 1]
    if (leaf !== undefined) {
      cursor[leaf] = event.value
    }
  }

  // Assign the patched reported back. The type of properties.reported is a specific interface,
  // but we have built it as a Record<string, unknown> view of the same underlying object
  // (structuredCloned then walked), so the assignment is shape-compatible after the runtime check
  // in asMutableRecord confirmed it was a non-null object.
  next.properties = { reported: reported as Appliance['properties']['reported'] }

  return next
}

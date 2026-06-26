/** Parsed, validated legacy POST body. */
export type LegacyBody = {
  userHash: string
  version: string
  channel?: 'stable' | 'beta'
}

export type ValidationResult = { ok: true; body: LegacyBody } | { ok: false; error: string }

const USER_HASH_RE = /^[0-9a-f]{64}$/
// Matches: optional leading v, three dot-separated numeric groups, optional pre-release suffix
// (either -<alphanumeric+dots> for SemVer or b<digits> for CalVer beta).
const VERSION_RE = /^v?\d+\.\d+\.\d+(-[a-z0-9.-]+|b\d+)?$/i
const MAX_VERSION_LEN = 32

/**
 * Validate a parsed (but unknown-typed) POST body against the legacy telemetry schema.
 * Returns { ok: true, body } on success or { ok: false, error } on failure.
 * Uses explicit `typeof` narrowing throughout — no `as` casts needed.
 */
export function validateLegacyBody(raw: unknown): ValidationResult {
  if (!isRecord(raw)) {
    return { ok: false, error: 'body must be a JSON object' }
  }

  // Narrow userHash: typeof narrows from unknown to string, then regex validates format.
  const rawUserHash = raw.userHash
  if (typeof rawUserHash !== 'string') return { ok: false, error: 'userHash must be a string' }
  if (!USER_HASH_RE.test(rawUserHash)) return { ok: false, error: 'userHash must be 64 lowercase hex characters' }

  // Narrow version
  const rawVersion = raw.version
  if (typeof rawVersion !== 'string') return { ok: false, error: 'version must be a string' }
  if (rawVersion.length === 0 || rawVersion.length > MAX_VERSION_LEN) {
    return { ok: false, error: `version must be 1–${MAX_VERSION_LEN} characters` }
  }
  if (!VERSION_RE.test(rawVersion)) return { ok: false, error: 'version must match semver or calver format' }

  // Narrow channel (optional)
  const channelResult = validateChannel(raw.channel)
  if (channelResult.error !== null) return { ok: false, error: channelResult.error }

  return {
    ok: true,
    body: { userHash: rawUserHash, version: rawVersion, channel: channelResult.channel },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ChannelResult = { channel: 'stable' | 'beta' | undefined; error: null } | { channel: undefined; error: string }

function validateChannel(value: unknown): ChannelResult {
  if (value === undefined) return { channel: undefined, error: null }
  if (value === 'stable' || value === 'beta') return { channel: value, error: null }
  return { channel: undefined, error: "channel must be 'stable' or 'beta' if present" }
}

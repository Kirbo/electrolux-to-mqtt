/**
 * Runtime guard for plain object records (not null, not array).
 */
function isObjectRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Produce a canonical JSON string with recursively sorted keys so the result
 * is deterministic regardless of object insertion order.
 * Used for stable hashing of capability objects and cache values.
 */
export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`
  }
  if (isObjectRecord(value)) {
    // Explicit byte-order comparator (NOT localeCompare): canonical hashing
    // must be deterministic across processes/locales, and locale-aware
    // ordering would defeat that guarantee. Default `.sort()` works for our
    // ASCII-only capability keys but Sonar (S2871) prefers an explicit one.
    const sorted = Object.keys(value)
      .sort((a, b) => {
        if (a < b) return -1
        if (a > b) return 1
        return 0
      })
      .map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`)
      .join(',')
    return `{${sorted}}`
  }
  return JSON.stringify(value)
}

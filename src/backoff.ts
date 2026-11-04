// Decorrelated jitter prevents coordinated retry storms across instances.
// Returns a value in [baseDelay/2, baseDelay] using full-jitter within the upper half.
function applyJitter(baseDelay: number): number {
  return baseDelay / 2 + Math.random() * (baseDelay / 2) // NOSONAR — non-crypto use; predictability is acceptable for retry jitter
}

/** Exponential backoff (doubling per attempt) capped at maxMs, with jitter. */
export function computeBackoffDelay(retryCount: number, baseMs: number, maxMs: number): number {
  return applyJitter(Math.min(baseMs * 2 ** retryCount, maxMs))
}

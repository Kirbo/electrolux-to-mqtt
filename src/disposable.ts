/**
 * Returns a Disposable that clears the timeout when disposed.
 * The callback fires once after `ms` milliseconds; disposing before it fires
 * cancels it.  Disposing after it has already fired is a no-op.
 */
export function disposableTimeout(fn: () => void, ms: number): Disposable {
  const id = setTimeout(fn, ms)
  return {
    [Symbol.dispose]() {
      clearTimeout(id)
    },
  }
}

/**
 * Returns a Disposable that clears the interval when disposed.
 * The callback fires repeatedly every `ms` milliseconds until disposed.
 * Calling dispose more than once is safe (extra calls are no-ops).
 */
export function disposableInterval(fn: () => void, ms: number): Disposable {
  const id = setInterval(fn, ms)
  return {
    [Symbol.dispose]() {
      clearInterval(id)
    },
  }
}

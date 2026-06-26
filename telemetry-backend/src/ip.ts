/**
 * Extract the originating client IP from request headers, with fallback to socket address.
 *
 * Accepts any header map whose values may be string, string[], or undefined — compatible
 * with both Node's `http.IncomingHttpHeaders` and plain test dictionaries.
 *
 * Precedence:
 *   1. X-Forwarded-For — first hop (set by the fronting nginx)
 *   2. X-Real-IP       — single-value header set by nginx
 *   3. socket address  — direct connection (no proxy)
 *   4. 'unknown'       — when none of the above is available
 */
export function extractClientIp(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  socketRemoteAddress?: string,
): string {
  const xff = headers['x-forwarded-for']
  if (xff) {
    const raw = Array.isArray(xff) ? xff[0] : xff
    if (raw) {
      const first = raw.split(',')[0]
      if (first) return first.trim()
    }
  }

  const realIp = headers['x-real-ip']
  if (realIp) {
    const raw = Array.isArray(realIp) ? realIp[0] : realIp
    if (raw) return raw.trim()
  }

  return socketRemoteAddress ?? 'unknown'
}

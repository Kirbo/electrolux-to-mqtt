/**
 * Extract the originating client IP from request headers, with fallback to socket address.
 *
 * Accepts any header map whose values may be string, string[], or undefined — compatible
 * with both Node's `http.IncomingHttpHeaders` and plain test dictionaries.
 *
 * Precedence:
 *   1. X-Real-IP       — single-value header the fronting nginx sets from $remote_addr
 *   2. X-Forwarded-For — LAST hop only: nginx's $proxy_add_x_forwarded_for APPENDS the
 *                        real address, so the first element stays client-supplied. Trusting
 *                        it would let a caller rotate rate-limiter keys at will.
 *   3. socket address  — direct connection (no proxy)
 *   4. 'unknown'       — when none of the above is available
 */
export function extractClientIp(
  headers: Readonly<Record<string, string | string[] | undefined>>,
  socketRemoteAddress?: string,
): string {
  const realIp = headers['x-real-ip']
  if (realIp) {
    const raw = Array.isArray(realIp) ? realIp[0] : realIp
    if (raw) return raw.trim()
  }

  const xff = headers['x-forwarded-for']
  if (xff) {
    const raw = Array.isArray(xff) ? xff[0] : xff
    if (raw) {
      const hops = raw.split(',')
      const last = hops[hops.length - 1]
      if (last?.trim()) return last.trim()
    }
  }

  return socketRemoteAddress ?? 'unknown'
}

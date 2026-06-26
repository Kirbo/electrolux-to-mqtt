export const INVISIBLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0"/>'

interface ParsedVersion {
  major: number
  minor: number
  patch: number
  preRelease: string | null
}

/**
 * Split a cleaned (no leading 'v') version string into its numeric core and
 * pre-release label. Supports two pre-release forms:
 *   - SemVer dash:  "1.18.5-rc.1"  → core "1.18.5", pre "rc.1"
 *   - CalVer beta:  "2026.6.0b1"   → core "2026.6.0", pre "b1"
 *   - Stable:       "2026.6.0"     → core "2026.6.0", pre null
 */
export function splitParsedVersion(withoutV: string): { numeric: string; preRelease: string | null } {
  const dashIndex = withoutV.indexOf('-')
  if (dashIndex !== -1) {
    return { numeric: withoutV.slice(0, dashIndex), preRelease: withoutV.slice(dashIndex + 1) }
  }
  const m = /^(\d+(?:\.\d+)*)(b\d+)$/.exec(withoutV)
  if (m?.[1] !== undefined && m[2] !== undefined) {
    return { numeric: m[1], preRelease: m[2] }
  }
  return { numeric: withoutV, preRelease: null }
}

export function parseVersion(raw: string): ParsedVersion {
  const withoutV = raw.replace(/^v/, '')
  const { numeric, preRelease } = splitParsedVersion(withoutV)
  const [maj, min, pat] = numeric.split('.').map(Number)
  return {
    major: maj ?? 0,
    minor: min ?? 0,
    patch: pat ?? 0,
    preRelease,
  }
}

export function comparePreRelease(a: string, b: string): number {
  // Extract all digits so both "rc.10" and "b2" compare numerically.
  // /\D/g removal is non-backtracking (single negated class) and avoids ReDoS.
  const numA = Number.parseInt(a.replace(/\D/g, '') || '0', 10)
  const numB = Number.parseInt(b.replace(/\D/g, '') || '0', 10)
  if (numB !== numA) return numB - numA
  // Same numeric suffix — fall back to lexicographic prefix comparison
  if (b > a) return 1
  if (b < a) return -1
  return 0
}

export function compareVersionsDescending(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)

  const majorDiff = pb.major - pa.major
  if (majorDiff !== 0) return majorDiff

  const minorDiff = pb.minor - pa.minor
  if (minorDiff !== 0) return minorDiff

  const patchDiff = pb.patch - pa.patch
  if (patchDiff !== 0) return patchDiff

  // Numeric parts equal — stable beats pre-release
  if (pa.preRelease === null && pb.preRelease !== null) return -1
  if (pa.preRelease !== null && pb.preRelease === null) return 1

  if (pa.preRelease !== null && pb.preRelease !== null) {
    return comparePreRelease(pa.preRelease, pb.preRelease)
  }

  return 0
}

/**
 * Returns true if the version string is a pre-release (beta or RC).
 * Matches both CalVer beta form (e.g. "2026.6.0b1") and SemVer dash form
 * (e.g. "1.18.5-rc.1"). An optional leading "v" is ignored.
 */
export function isPreReleaseVersion(version: string): boolean {
  return version.includes('-') || /\db\d+$/.test(version)
}

/**
 * Escape characters that are special in XML/SVG text content and attribute values.
 * Must escape `&` first to avoid double-escaping subsequent replacements.
 */
export function escapeXml(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function buildBadgeSvg(total: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="100" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h47v20H0z"/>
    <path fill="#4c1" d="M47 0h53v20H47z"/>
    <path fill="url(#b)" d="M0 0h100v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="24.5" y="15" fill="#010101" fill-opacity=".3">Users</text>
    <text x="24.5" y="14">Users</text>
    <text x="72.5" y="15" fill="#010101" fill-opacity=".3">${escapeXml(String(total))}</text>
    <text x="72.5" y="14">${escapeXml(String(total))}</text>
  </g>
</svg>`
}

export function buildReleaseBadgeSvg(label: string, version: string, color: string): string {
  // Use raw strings for geometry (length in display chars, not escaped entity chars)
  const labelWidth = Math.round(label.length * 7 + 14)
  const valueWidth = Math.round(version.length * 7 + 14)
  const totalWidth = labelWidth + valueWidth
  const labelX = Math.round(labelWidth / 2)
  const valueX = labelWidth + Math.round(valueWidth / 2)

  // Escape only for text node interpolation — never reassign the geometry variables
  const safeLabel = escapeXml(label)
  const safeVersion = escapeXml(version)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h${labelWidth}v20H0z"/>
    <path fill="${color}" d="M${labelWidth} 0h${valueWidth}v20H${labelWidth}z"/>
    <path fill="url(#b)" d="M0 0h${totalWidth}v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelX}" y="15" fill="#010101" fill-opacity=".3">${safeLabel}</text>
    <text x="${labelX}" y="14">${safeLabel}</text>
    <text x="${valueX}" y="15" fill="#010101" fill-opacity=".3">${safeVersion}</text>
    <text x="${valueX}" y="14">${safeVersion}</text>
  </g>
</svg>`
}

export function isBetaTag(tagName: string): boolean {
  const withoutV = tagName.replace(/^v/, '')
  return /b\d+$/.test(withoutV)
}

export function hasStringTagName(v: unknown): v is { tag_name: string } {
  return typeof v === 'object' && v !== null && 'tag_name' in v && typeof v.tag_name === 'string'
}

export async function fetchLatestReleases(
  url: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ stable: string | null; beta: string | null }> {
  const res = await fetchFn(url)
  if (!res.ok) {
    throw new Error(`GitLab releases API returned ${res.status}`)
  }
  const data: unknown = await res.json()
  if (!Array.isArray(data)) {
    throw new Error('GitLab releases API returned a non-array body')
  }

  let stable: string | null = null
  let beta: string | null = null

  for (const item of data) {
    if (!hasStringTagName(item)) continue
    const tag = item.tag_name
    if (stable === null && !isBetaTag(tag)) {
      stable = tag
    }
    if (beta === null && isBetaTag(tag)) {
      beta = tag
    }
    if (stable !== null && beta !== null) break
  }

  return { stable, beta }
}

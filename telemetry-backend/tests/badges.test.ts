import { describe, expect, it, vi } from 'vitest'
import {
  buildBadgeSvg,
  buildReleaseBadgeSvg,
  compareVersionsDescending,
  escapeXml,
  fetchLatestReleases,
  INVISIBLE_SVG,
  isBetaTag,
  isPreReleaseVersion,
  parseVersion,
  splitParsedVersion,
} from '../src/badges.js'

describe('escapeXml', () => {
  it('escapes & before < and > to avoid double-escaping', () => {
    expect(escapeXml('a&b<c>d"e')).toBe('a&amp;b&lt;c&gt;d&quot;e')
  })

  it('returns plain strings unchanged', () => {
    expect(escapeXml('hello world')).toBe('hello world')
  })
})

describe('INVISIBLE_SVG', () => {
  it('is a valid self-closing SVG element with zero dimensions', () => {
    expect(INVISIBLE_SVG).toContain('width="0"')
    expect(INVISIBLE_SVG).toContain('height="0"')
  })
})

describe('buildBadgeSvg', () => {
  it('renders the total count in the SVG', () => {
    const svg = buildBadgeSvg(42)
    expect(svg).toContain('42')
    expect(svg).toContain('Users')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('handles zero total', () => {
    const svg = buildBadgeSvg(0)
    expect(svg).toContain('0')
  })
})

describe('buildReleaseBadgeSvg', () => {
  it('renders label and version text', () => {
    const svg = buildReleaseBadgeSvg('stable', '2026.6.0', '#007ec6')
    expect(svg).toContain('stable')
    expect(svg).toContain('2026.6.0')
    expect(svg).toContain('#007ec6')
  })

  it('escapes XML-special characters in label and version', () => {
    const svg = buildReleaseBadgeSvg('a&b', '1.0<0>', '#fff')
    expect(svg).toContain('a&amp;b')
    expect(svg).toContain('1.0&lt;0&gt;')
  })
})

describe('splitParsedVersion', () => {
  it('splits a SemVer dash pre-release', () => {
    expect(splitParsedVersion('1.18.5-rc.1')).toEqual({ numeric: '1.18.5', preRelease: 'rc.1' })
  })

  it('splits a CalVer beta suffix', () => {
    expect(splitParsedVersion('2026.6.0b1')).toEqual({ numeric: '2026.6.0', preRelease: 'b1' })
  })

  it('returns null preRelease for stable versions', () => {
    expect(splitParsedVersion('2026.6.0')).toEqual({ numeric: '2026.6.0', preRelease: null })
  })
})

describe('parseVersion', () => {
  it('strips leading v', () => {
    expect(parseVersion('v2026.6.0')).toMatchObject({ major: 2026, minor: 6, patch: 0, preRelease: null })
  })

  it('parses a beta version', () => {
    expect(parseVersion('2026.6.0b1')).toMatchObject({ major: 2026, minor: 6, patch: 0, preRelease: 'b1' })
  })
})

describe('compareVersionsDescending', () => {
  it('sorts stable before beta of same numeric version', () => {
    expect(compareVersionsDescending('2026.6.0', '2026.6.0b1')).toBeLessThan(0)
  })

  it('sorts higher version first', () => {
    expect(compareVersionsDescending('2026.6.1', '2026.6.0')).toBeLessThan(0)
  })

  it('returns 0 for equal versions', () => {
    expect(compareVersionsDescending('2026.6.0', '2026.6.0')).toBe(0)
  })

  it('puts newer beta before older beta of same release', () => {
    expect(compareVersionsDescending('2026.6.0b2', '2026.6.0b1')).toBeLessThan(0)
  })
})

describe('isPreReleaseVersion', () => {
  it('returns true for CalVer beta', () => {
    expect(isPreReleaseVersion('2026.6.0b1')).toBe(true)
  })

  it('returns true for SemVer dash pre-release', () => {
    expect(isPreReleaseVersion('1.18.5-rc.1')).toBe(true)
  })

  it('returns false for stable', () => {
    expect(isPreReleaseVersion('2026.6.0')).toBe(false)
  })
})

describe('isBetaTag', () => {
  it('returns true for a CalVer beta tag', () => {
    expect(isBetaTag('2026.6.0b1')).toBe(true)
    expect(isBetaTag('v2026.6.0b1')).toBe(true)
  })

  it('returns false for a stable tag', () => {
    expect(isBetaTag('2026.6.0')).toBe(false)
    expect(isBetaTag('v2026.6.0')).toBe(false)
  })
})

describe('fetchLatestReleases', () => {
  it('returns stable and beta from the releases array', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ tag_name: '2026.6.0b1' }, { tag_name: '2026.5.0' }, { tag_name: '2026.4.0' }],
    })

    const result = await fetchLatestReleases('https://example.com/releases', mockFetch as typeof fetch)
    expect(result).toEqual({ stable: '2026.5.0', beta: '2026.6.0b1' })
  })

  it('returns null for missing stable when only betas exist', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ tag_name: '2026.6.0b1' }],
    })

    const result = await fetchLatestReleases('https://example.com/releases', mockFetch as typeof fetch)
    expect(result).toEqual({ stable: null, beta: '2026.6.0b1' })
  })

  it('throws on non-OK HTTP response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 })

    await expect(fetchLatestReleases('https://example.com/releases', mockFetch as typeof fetch)).rejects.toThrow(
      'GitLab releases API returned 404',
    )
  })

  it('throws when response body is not an array', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'not an array' }),
    })

    await expect(fetchLatestReleases('https://example.com/releases', mockFetch as typeof fetch)).rejects.toThrow(
      'non-array body',
    )
  })

  it('skips items without string tag_name', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ tag_name: 42 }, null, { tag_name: '2026.5.0' }],
    })

    const result = await fetchLatestReleases('https://example.com/releases', mockFetch as typeof fetch)
    expect(result.stable).toBe('2026.5.0')
  })
})

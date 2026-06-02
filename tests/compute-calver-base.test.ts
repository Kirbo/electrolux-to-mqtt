import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Exercises the POSIX-sh CalVer base calculator used by the CI bump-version job
// (.gitlab/ci/01_init.yml). Runs the real script as a subprocess with
// controlled tag lists so the contract is verified on every `pnpm test`.
const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/compute-calver-base.sh')

function computeBase(year: string, month: string, tags: string[]): string {
  return execFileSync('sh', [scriptPath, year, month], { input: tags.join('\n'), encoding: 'utf8' }).trim()
}

describe('compute-calver-base.sh', () => {
  it('returns .0 when no stable tags exist for the year.month', () => {
    expect(computeBase('2026', '6', [])).toBe('2026.6.0')
  })

  it('increments past the highest existing stable micro', () => {
    expect(computeBase('2026', '6', ['v2026.6.0', 'v2026.6.1'])).toBe('2026.6.2')
  })

  it('compares micro numbers numerically, not lexically (.10 > .9)', () => {
    expect(computeBase('2026', '6', ['v2026.6.9', 'v2026.6.10'])).toBe('2026.6.11')
  })

  it('ignores tags from other months and years', () => {
    expect(computeBase('2026', '6', ['v2026.5.4', 'v2026.7.0', 'v2025.6.9'])).toBe('2026.6.0')
  })

  it('does not count beta tags as stable releases (first stable is still .0)', () => {
    expect(computeBase('2026', '6', ['v2026.6.0b1', 'v2026.6.0b2'])).toBe('2026.6.0')
  })

  it('counts only stable tags when both stable and beta tags are present', () => {
    // v2026.6.0 is stable; v2026.6.0b1 and v2026.6.1b3 are betas — only .0 counts
    expect(computeBase('2026', '6', ['v2026.6.0', 'v2026.6.0b1', 'v2026.6.1b3'])).toBe('2026.6.1')
  })

  it('does not match a month that is a prefix of the given month (6 vs 60)', () => {
    expect(computeBase('2026', '6', ['v2026.60.0'])).toBe('2026.6.0')
  })

  it('does not match a year that is a prefix of the given year (2026 vs 20260)', () => {
    expect(computeBase('2026', '6', ['v20260.6.0'])).toBe('2026.6.0')
  })

  it('ignores blank lines and junk', () => {
    expect(computeBase('2026', '6', ['', 'not-a-tag', 'v2026.6.x', 'v2026.6.1'])).toBe('2026.6.2')
  })
})

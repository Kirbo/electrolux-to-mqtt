import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Exercises the POSIX-sh CalVer beta calculator used by the CI bump-version job
// (.gitlab/ci/01_init.yml). Runs the real script as a subprocess with
// controlled tag lists so the contract is verified on every `pnpm test`.
const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/compute-calver-beta.sh')

function computeBeta(base: string, tags: string[]): string {
  return execFileSync('sh', [scriptPath, base], { input: tags.join('\n'), encoding: 'utf8' }).trim()
}

describe('compute-calver-beta.sh', () => {
  it('starts at b1 when no beta tag exists for the base', () => {
    expect(computeBeta('2026.6.0', [])).toBe('2026.6.0b1')
  })

  it('increments past the highest existing beta number', () => {
    expect(computeBeta('2026.6.0', ['v2026.6.0b1', 'v2026.6.0b2'])).toBe('2026.6.0b3')
  })

  it('compares beta numbers numerically, not lexically (b10 > b9)', () => {
    expect(computeBeta('2026.6.0', ['v2026.6.0b9', 'v2026.6.0b10'])).toBe('2026.6.0b11')
  })

  it('ignores betas belonging to other bases', () => {
    expect(computeBeta('2026.6.0', ['v2026.6.1b5', 'v2026.7.0b2'])).toBe('2026.6.0b1')
  })

  it('does not match the bare stable tag as a beta', () => {
    expect(computeBeta('2026.6.0', ['v2026.6.0'])).toBe('2026.6.0b1')
  })

  it('does not match a base that is a prefix of the given base (2026.6.1 vs 2026.6.10)', () => {
    // v2026.6.10b2 must NOT match base 2026.6.1 — the literal dot-escaped anchor prevents this
    expect(computeBeta('2026.6.1', ['v2026.6.10b2'])).toBe('2026.6.1b1')
  })

  it('ignores blank lines and junk', () => {
    expect(computeBeta('2026.6.0', ['', 'not-a-tag', 'v2026.6.0', 'v2026.6.0bx', 'v2026.6.0b3'])).toBe('2026.6.0b4')
  })
})

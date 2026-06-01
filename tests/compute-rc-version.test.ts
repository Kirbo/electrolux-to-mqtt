import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Exercises the POSIX-sh RC calculator used by the CI bump-version job
// (.gitlab/ci/01_init.yml). Runs the real script as a subprocess with
// controlled tag lists so the contract is verified on every `pnpm test`.
const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts/compute-rc-version.sh')

function computeRc(base: string, tags: string[]): string {
  return execFileSync('sh', [scriptPath, base], { input: tags.join('\n'), encoding: 'utf8' }).trim()
}

describe('compute-rc-version.sh', () => {
  it('starts at rc.1 when no RC tag exists for the base', () => {
    expect(computeRc('1.19.0', [])).toBe('1.19.0-rc.1')
  })

  it('increments the highest existing RC for the base', () => {
    expect(computeRc('1.18.5', ['v1.18.5-rc.1', 'v1.18.5-rc.2', 'v1.18.5-rc.3', 'v1.18.5-rc.4', 'v1.18.5-rc.5'])).toBe(
      '1.18.5-rc.6',
    )
  })

  it('compares RC numbers numerically, not lexically (rc.10 > rc.9)', () => {
    expect(computeRc('1.18.5', ['v1.18.5-rc.9', 'v1.18.5-rc.10'])).toBe('1.18.5-rc.11')
  })

  it('ignores RC tags belonging to other base versions', () => {
    expect(computeRc('1.18.5', ['v1.17.0-rc.7', 'v1.19.0-rc.3', 'v1.18.5-rc.2'])).toBe('1.18.5-rc.3')
  })

  it('resets to rc.1 on a base bump (no tags for the new base yet)', () => {
    // e.g. a feat moved the base from 1.18.5 to 1.19.0
    const oldSeries = ['v1.18.5-rc.1', 'v1.18.5-rc.2', 'v1.18.5-rc.3', 'v1.18.5-rc.4', 'v1.18.5-rc.5']
    expect(computeRc('1.19.0', oldSeries)).toBe('1.19.0-rc.1')
  })

  it('uses the max rc, not the count, when the sequence has gaps', () => {
    expect(computeRc('1.18.5', ['v1.18.5-rc.1', 'v1.18.5-rc.3'])).toBe('1.18.5-rc.4')
  })

  it('does not match a numerically-similar base prefix (1.18.50 vs 1.18.5)', () => {
    expect(computeRc('1.18.5', ['v1.18.50-rc.9'])).toBe('1.18.5-rc.1')
  })

  it('ignores blank lines and non-matching junk', () => {
    expect(computeRc('1.18.5', ['', 'not-a-tag', 'v1.18.5', 'v1.18.5-rc.x', 'v1.18.5-rc.2'])).toBe('1.18.5-rc.3')
  })
})

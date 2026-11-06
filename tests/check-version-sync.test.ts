import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Exercises scripts/check-version-sync.mjs, the drift check that scripts/sync-versions.sh
// (CI job `versions in sync`) runs: it runs the real script against a copy of the repo's
// version-bearing files, each test breaking one of them.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scriptPath = path.join(repoRoot, 'scripts/check-version-sync.mjs')
const FILES = [
  'versions.env',
  'mise.toml',
  'mise.lock',
  'docker/Dockerfile',
  'docker/Dockerfile.local',
  'telemetry-backend/Dockerfile',
  '.gitlab-ci.yml',
  '.gitlab/ci/01_init.yml',
  '.gitlab/ci/02_test.yml',
  '.gitlab/ci/03_build.yml',
  '.gitlab/ci/04_release.yml',
]

let root = ''

function run(): { status: number | null; output: string } {
  const res = spawnSync(process.execPath, [scriptPath, root], { encoding: 'utf8' })
  return { status: res.status, output: `${res.stdout}${res.stderr}` }
}

function rewrite(file: string, from: string | RegExp, to: string): void {
  const p = path.join(root, file)
  const before = readFileSync(p, 'utf8')
  const after = before.replace(from, to)
  expect(after, `${file}: pattern ${String(from)} not found`).not.toBe(before)
  writeFileSync(p, after)
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'e2m-version-sync-'))
  for (const f of FILES) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true })
    cpSync(path.join(repoRoot, f), path.join(root, f))
  }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('check-version-sync.mjs', () => {
  it('passes on the repository as committed', () => {
    const { status, output } = run()
    expect(output).toContain('agree with versions.env')
    expect(status).toBe(0)
  })

  it('fails a mise tool pinned to a literal version instead of versions.env', () => {
    rewrite('mise.toml', 'fnox = "{{ env.FNOX_VERSION }}"', 'fnox = "1.47.0"')
    const { status, output } = run()
    expect(status).toBe(1)
    expect(output).toContain('every tool reads versions.env')
    expect(output).toContain('mise.lock locks fnox, which mise.toml no longer pins')
  })

  it('fails a fuzzy Node version in versions.env', () => {
    rewrite('versions.env', /^NODE_VERSION=.*$/m, 'NODE_VERSION=26')
    const { status, output } = run()
    expect(status).toBe(1)
    expect(output).toContain('versions.env NODE_VERSION (mise tool node) is "26"')
  })

  it('fails a lock that disagrees with versions.env', () => {
    rewrite('versions.env', /^GIT_CLIFF_VERSION=.*$/m, 'GIT_CLIFF_VERSION=9.9.9')
    const { status, output } = run()
    expect(status).toBe(1)
    expect(output).toMatch(/mise\.lock locks git-cliff \S+ but versions\.env says 9\.9\.9/)
  })

  it('fails a lock missing a platform artifact', () => {
    rewrite('mise.toml', /lockfile_platforms = \[/, 'lockfile_platforms = ["macos-x64", ')
    const { status, output } = run()
    expect(status).toBe(1)
    expect(output).toContain('mise.lock has no macos-x64 artifact for node')
  })

  it('fails when the lock or the release-age quarantine is switched off', () => {
    rewrite('mise.toml', 'lockfile = true', 'lockfile = false')
    rewrite('mise.toml', /minimum_release_age = "[^"]*"/, 'minimum_release_age = "0s"')
    rewrite('mise.toml', '"linux-arm64", ', '')
    const { output } = run()
    expect(output).toContain('`lockfile = true`')
    expect(output).toContain('`minimum_release_age`')
    expect(output).toContain('lockfile_platforms must include linux-arm64')
  })

  it('fails an unparseable lock line', () => {
    writeFileSync(path.join(root, 'mise.lock'), 'garbage line\n')
    const { status, output } = run()
    expect(status).toBe(1)
    expect(output).toContain('mise.lock:1: cannot parse')
  })

  it('fails a Dockerfile FROM that is not digest-pinned', () => {
    rewrite('docker/Dockerfile.local', /@\$\{NODE_STOCK_DIGEST:\?[^}]*\}/, '')
    const { status, output } = run()
    expect(status).toBe(1)
    expect(output).toContain(`docker/Dockerfile.local: FROM node:\${NODE_VERSION}-alpine\${ALPINE_VERSION} — must be`)
  })

  it('fails a prod stage on the wrong base', () => {
    rewrite('docker/Dockerfile', `FROM \${NODE_DEV_IMAGE} AS purge`, 'FROM node:26-alpine AS purge')
    const { status, output } = run()
    expect(status).toBe(1)
    expect(output).toContain('docker/Dockerfile: FROM node:26-alpine')
  })

  it('fails a CI job on a literal node image', () => {
    rewrite('.gitlab/ci/02_test.yml', `image: \${NODE_CI_IMAGE}`, 'image: node:26-alpine3.24')
    const { status, output } = run()
    expect(status).toBe(1)
    expect(output).toMatch(/\.gitlab\/ci\/02_test\.yml:\d+: job image node:26-alpine3\.24/)
  })

  it('fails when no job builds NODE_CI_IMAGE from versions.env', () => {
    rewrite('.gitlab/ci/01_init.yml', `@\${NODE_STOCK_DIGEST:?}`, '')
    const { status, output } = run()
    expect(status).toBe(1)
    expect(output).toContain('no CI file sets NODE_CI_IMAGE')
  })

  it('fails a git-cliff image tag not taken from versions.env', () => {
    rewrite('.gitlab/ci/01_init.yml', `orhunp/git-cliff:\${GIT_CLIFF_VERSION}`, 'orhunp/git-cliff:latest')
    const { status, output } = run()
    expect(status).toBe(1)
    expect(output).toContain(`git-cliff's image tag is \${GIT_CLIFF_VERSION}`)
  })
})

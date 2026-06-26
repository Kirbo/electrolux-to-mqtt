import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { FileWriter, ReleasesFetcher } from '../src/badge-store.js'
import { createBadgeStore } from '../src/badge-store.js'
import { INVISIBLE_SVG } from '../src/badges.js'
import { FakeClickHouse } from './fake-clickhouse.js'

const OUT = '/out'
const usersFile = path.join(OUT, 'users.svg')
const telemetryFile = path.join(OUT, 'telemetry.json')
const stableFile = path.join(OUT, 'stable.svg')
const betaFile = path.join(OUT, 'beta.svg')

function recordingWriter(): { writeFile: FileWriter; files: Map<string, string> } {
  const files = new Map<string, string>()
  const writeFile: FileWriter = async (filePath, content) => {
    files.set(filePath, content)
  }
  return { writeFile, files }
}

function buildFakeCh(total = 5): FakeClickHouse {
  const fake = new FakeClickHouse()
  fake.onQuery('uniqExact(user_id) AS total', () => [{ total }])
  fake.onQuery('GROUP BY version, channel', () => [{ version: '2026.6.0', channel: 'stable', count: total }])
  return fake
}

const stableRelease: ReleasesFetcher = async () => ({ stable: 'v2026.6.0', beta: null })
const bothReleases: ReleasesFetcher = async () => ({ stable: 'v2026.5.0', beta: 'v2026.6.0b1' })
const betaOnlyReleases: ReleasesFetcher = async () => ({ stable: null, beta: 'v2026.6.0b1' })
const noReleases: ReleasesFetcher = async () => ({ stable: null, beta: null })

function makeStore(opts: { ch?: FakeClickHouse; releasesFetcher?: ReleasesFetcher; writeFile: FileWriter }) {
  return createBadgeStore({
    ch: opts.ch ?? buildFakeCh(),
    appId: 'test-app',
    releasesApiUrl: 'https://example.com',
    outputDir: OUT,
    releasesFetcher: opts.releasesFetcher ?? stableRelease,
    writeFile: opts.writeFile,
  })
}

describe('createBadgeStore', () => {
  describe('initial state', () => {
    it('getters return null before the first regenerate', () => {
      const store = makeStore({ writeFile: recordingWriter().writeFile })
      expect(store.getTelemetryJson()).toBeNull()
      expect(store.getStableTag()).toBeNull()
      expect(store.getBetaTag()).toBeNull()
    })
  })

  describe('after a successful regenerate (stable only)', () => {
    it('writes users.svg with the count and telemetry.json with the total', async () => {
      const { writeFile, files } = recordingWriter()
      const store = makeStore({ ch: buildFakeCh(42), writeFile })
      await store.regenerate()
      expect(files.get(usersFile)).toContain('42')
      expect(files.get(usersFile)).toContain('Users')
      const json = files.get(telemetryFile) ?? ''
      expect((JSON.parse(json) as { total: number }).total).toBe(42)
      expect(store.getTelemetryJson()).toBe(json)
    })

    it('writes stable.svg with the version and exposes the stable tag', async () => {
      const { writeFile, files } = recordingWriter()
      const store = makeStore({ writeFile })
      await store.regenerate()
      expect(files.get(stableFile)).toContain('2026.6.0')
      expect(store.getStableTag()).toBe('v2026.6.0')
    })

    it('writes an invisible beta.svg and a null beta tag when beta is not newer', async () => {
      const { writeFile, files } = recordingWriter()
      const store = makeStore({ writeFile })
      await store.regenerate()
      expect(files.get(betaFile)).toBe(INVISIBLE_SVG)
      expect(store.getBetaTag()).toBeNull()
    })
  })

  describe('beta newer than stable', () => {
    it('writes beta.svg with the version and exposes the beta tag', async () => {
      const { writeFile, files } = recordingWriter()
      const store = makeStore({ releasesFetcher: bothReleases, writeFile })
      await store.regenerate()
      expect(files.get(betaFile)).toContain('2026.6.0b1')
      expect(store.getBetaTag()).toBe('v2026.6.0b1')
    })

    it('treats beta as newer when there is no stable', async () => {
      const { writeFile, files } = recordingWriter()
      const store = makeStore({ releasesFetcher: betaOnlyReleases, writeFile })
      await store.regenerate()
      expect(files.get(betaFile)).toContain('2026.6.0b1')
      expect(store.getBetaTag()).toBe('v2026.6.0b1')
    })
  })

  describe('best-effort: telemetry failure', () => {
    it('writes no users.svg/telemetry.json and keeps the JSON null when ClickHouse throws', async () => {
      const { writeFile, files } = recordingWriter()
      const store = makeStore({ ch: new FakeClickHouse(), writeFile })
      await store.regenerate()
      expect(files.has(usersFile)).toBe(false)
      expect(files.has(telemetryFile)).toBe(false)
      expect(store.getTelemetryJson()).toBeNull()
    })

    it('still writes release badges when telemetry fails', async () => {
      const { writeFile, files } = recordingWriter()
      const store = makeStore({ ch: new FakeClickHouse(), writeFile })
      await store.regenerate()
      expect(files.get(stableFile)).toContain('2026.6.0')
      expect(store.getStableTag()).toBe('v2026.6.0')
    })
  })

  describe('best-effort: releases failure', () => {
    it('writes no release SVGs and keeps tags null when the releases fetcher throws', async () => {
      const { writeFile, files } = recordingWriter()
      const throwing: ReleasesFetcher = () => Promise.reject(new Error('Network error'))
      const store = makeStore({ ch: buildFakeCh(3), releasesFetcher: throwing, writeFile })
      await store.regenerate()
      expect(files.has(stableFile)).toBe(false)
      expect(files.has(betaFile)).toBe(false)
      expect(store.getStableTag()).toBeNull()
    })

    it('still writes telemetry when releases fail', async () => {
      const { writeFile, files } = recordingWriter()
      const throwing: ReleasesFetcher = () => Promise.reject(new Error('Network error'))
      const store = makeStore({ ch: buildFakeCh(3), releasesFetcher: throwing, writeFile })
      await store.regenerate()
      expect(files.has(usersFile)).toBe(true)
      expect(store.getTelemetryJson()).not.toBeNull()
    })
  })

  describe('last-good preservation', () => {
    it('retains the last-good telemetry JSON when a later cycle fails', async () => {
      let calls = 0
      const ch = new FakeClickHouse()
      ch.onQuery('uniqExact(user_id) AS total', () => {
        calls++
        if (calls > 1) throw new Error('CH temporarily unavailable')
        return [{ total: 99 }]
      })
      ch.onQuery('GROUP BY version, channel', () => [])
      const store = makeStore({ ch, releasesFetcher: noReleases, writeFile: recordingWriter().writeFile })

      await store.regenerate()
      const first = store.getTelemetryJson()
      expect(first).toContain('99')

      await store.regenerate() // telemetry now fails
      expect(store.getTelemetryJson()).toBe(first)
    })
  })

  describe('no-releases edge case', () => {
    it('writes no release SVGs and keeps tags null when the API returns nothing', async () => {
      const { writeFile, files } = recordingWriter()
      const store = makeStore({ releasesFetcher: noReleases, writeFile })
      await store.regenerate()
      expect(files.has(stableFile)).toBe(false)
      expect(files.has(betaFile)).toBe(false)
      expect(store.getStableTag()).toBeNull()
      expect(store.getBetaTag()).toBeNull()
    })
  })

  describe('console logging', () => {
    it('logs the telemetry update', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const store = makeStore({
        ch: buildFakeCh(42),
        releasesFetcher: noReleases,
        writeFile: recordingWriter().writeFile,
      })
      await store.regenerate()
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('42 users'))
      spy.mockRestore()
    })

    it('logs an error when ClickHouse throws', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const store = makeStore({
        ch: new FakeClickHouse(),
        releasesFetcher: noReleases,
        writeFile: recordingWriter().writeFile,
      })
      await store.regenerate()
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('[telemetry-backend]'), expect.any(Error))
      spy.mockRestore()
    })
  })
})

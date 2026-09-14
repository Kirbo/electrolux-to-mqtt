import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { FileReader, FileWriter, ReleasesFetcher } from '../src/badge-store.js'
import { createBadgeStore } from '../src/badge-store.js'
import { INVISIBLE_SVG } from '../src/badges.js'
import type { Peaks } from '../src/peaks.js'
import { FakeClickHouse } from './fake-clickhouse.js'

const OUT = '/out'
const usersFile = path.join(OUT, 'users.svg')
const telemetryFile = path.join(OUT, 'telemetry.json')
const stableFile = path.join(OUT, 'stable.svg')
const betaFile = path.join(OUT, 'beta.svg')
const peaksFile = path.join(OUT, 'peaks-history.json')
const HOUR = 3_600_000
const T0 = Date.UTC(2026, 8, 15, 12, 0, 0)

function recordingWriter(): { writeFile: FileWriter; files: Map<string, string> } {
  const files = new Map<string, string>()
  const writeFile: FileWriter = async (filePath, content) => {
    files.set(filePath, content)
  }
  return { writeFile, files }
}

function buildFakeCh(total = 5): FakeClickHouse {
  const fake = new FakeClickHouse()
  fake.onQuery('uniqExact(session_id) AS total', () => [{ total }])
  fake.onQuery('GROUP BY channel', () => [{ channel: 'stable', count: total }])
  fake.onQuery('GROUP BY version, channel', () => [{ version: '2026.6.0', channel: 'stable', count: total }])
  return fake
}

const stableRelease: ReleasesFetcher = async () => ({ stable: 'v2026.6.0', beta: null })
const bothReleases: ReleasesFetcher = async () => ({ stable: 'v2026.5.0', beta: 'v2026.6.0b1' })
const betaOnlyReleases: ReleasesFetcher = async () => ({ stable: null, beta: 'v2026.6.0b1' })
const noReleases: ReleasesFetcher = async () => ({ stable: null, beta: null })

function makeStore(opts: {
  ch?: FakeClickHouse
  releasesFetcher?: ReleasesFetcher
  writeFile: FileWriter
  readFile?: FileReader
  now?: () => number
}) {
  return createBadgeStore({
    ch: opts.ch ?? buildFakeCh(),
    appId: 'test-app',
    releasesApiUrl: 'https://example.com',
    outputDir: OUT,
    releasesFetcher: opts.releasesFetcher ?? stableRelease,
    writeFile: opts.writeFile,
    readFile: opts.readFile ?? (async () => null),
    now: opts.now ?? (() => T0),
  })
}

function peaksOf(json: string | undefined): Peaks {
  return (JSON.parse(json ?? '{}') as { peaks: Peaks }).peaks
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
      ch.onQuery('uniqExact(session_id) AS total', () => {
        calls++
        if (calls > 1) throw new Error('CH temporarily unavailable')
        return [{ total: 99 }]
      })
      ch.onQuery('GROUP BY channel', () => [])
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

  describe('peak history', () => {
    it('reports the current total as every window peak on the first cycle and persists the history', async () => {
      const { writeFile, files } = recordingWriter()
      const store = makeStore({ ch: buildFakeCh(42), releasesFetcher: noReleases, writeFile })
      await store.regenerate()
      const peaks = peaksOf(files.get(telemetryFile))
      const expected = { value: 42, at: new Date(T0).toISOString() }
      expect(peaks).toEqual({ '24h': expected, '7d': expected, '30d': expected, '182d': expected, '365d': expected })
      expect(JSON.parse(files.get(peaksFile) ?? '')).toEqual({ version: 1, buckets: [{ hour: T0, max: 42 }] })
    })

    it('writes one peak badge per window', async () => {
      const { writeFile, files } = recordingWriter()
      const store = makeStore({ ch: buildFakeCh(42), releasesFetcher: noReleases, writeFile })
      await store.regenerate()
      for (const key of ['24h', '7d', '30d', '182d', '365d']) {
        const svg = files.get(path.join(OUT, `peak-${key}.svg`))
        expect(svg).toContain(`>peak ${key}<`)
        expect(svg).toContain('>42<')
      }
    })

    it('keeps the earlier higher sample as the peak when the count drops', async () => {
      const { writeFile, files } = recordingWriter()
      let total = 10
      let now = T0
      const ch = new FakeClickHouse()
      ch.onQuery('uniqExact(session_id) AS total', () => [{ total }])
      ch.onQuery('GROUP BY channel', () => [])
      ch.onQuery('GROUP BY version, channel', () => [])
      const store = makeStore({ ch, releasesFetcher: noReleases, writeFile, now: () => now })
      await store.regenerate()
      total = 3
      now = T0 + 2 * HOUR
      await store.regenerate()
      const peaks = peaksOf(files.get(telemetryFile))
      expect(peaks['24h']).toEqual({ value: 10, at: new Date(T0).toISOString() })
      expect((JSON.parse(files.get(telemetryFile) ?? '') as { total: number }).total).toBe(3)
      expect(JSON.parse(files.get(peaksFile) ?? '')).toEqual({
        version: 1,
        buckets: [
          { hour: T0, max: 10 },
          { hour: T0 + 2 * HOUR, max: 3 },
        ],
      })
    })

    it('loads the persisted history from disk before the first cycle', async () => {
      const { writeFile, files } = recordingWriter()
      const onDisk = JSON.stringify({ version: 1, buckets: [{ hour: T0 - 3 * HOUR, max: 50 }] })
      const readFile: FileReader = async (filePath) => (filePath === peaksFile ? onDisk : null)
      const store = makeStore({ ch: buildFakeCh(7), releasesFetcher: noReleases, writeFile, readFile })
      await store.regenerate()
      expect(peaksOf(files.get(telemetryFile))['24h']).toEqual({ value: 50, at: new Date(T0 - 3 * HOUR).toISOString() })
    })

    it('reads the history only once across cycles', async () => {
      const readFile = vi.fn<FileReader>(async () => null)
      const store = makeStore({ releasesFetcher: noReleases, writeFile: recordingWriter().writeFile, readFile })
      await store.regenerate()
      await store.regenerate()
      expect(readFile).toHaveBeenCalledTimes(1)
    })

    it('starts fresh and warns when the persisted history is corrupt', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { writeFile, files } = recordingWriter()
      const store = makeStore({
        ch: buildFakeCh(7),
        releasesFetcher: noReleases,
        writeFile,
        readFile: async () => '{"version":99}',
      })
      await store.regenerate()
      expect(peaksOf(files.get(telemetryFile))['365d']?.value).toBe(7)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('peaks-history.json'))
      warn.mockRestore()
    })

    it('skips the peak history for the cycle and retries next time when reading it throws', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const { writeFile, files } = recordingWriter()
      const onDisk = JSON.stringify({ version: 1, buckets: [{ hour: T0 - HOUR, max: 50 }] })
      let fail = true
      const readFile = vi.fn<FileReader>(async () => {
        if (fail) throw new Error('EACCES')
        return onDisk
      })
      const store = makeStore({ ch: buildFakeCh(7), releasesFetcher: noReleases, writeFile, readFile })

      await store.regenerate()
      // Badge + JSON still refresh, but the history on disk is never overwritten from a failed read.
      expect(files.get(usersFile)).toContain('7')
      expect(peaksOf(files.get(telemetryFile))['365d']).toBeNull()
      expect(files.has(peaksFile)).toBe(false)
      expect(error).toHaveBeenCalledWith(expect.stringContaining('peaks-history.json'), expect.any(Error))

      fail = false
      await store.regenerate()
      expect(readFile).toHaveBeenCalledTimes(2)
      expect(peaksOf(files.get(telemetryFile))['24h']).toEqual({ value: 50, at: new Date(T0 - HOUR).toISOString() })
      expect(files.has(peaksFile)).toBe(true)
      error.mockRestore()
    })

    it('does not record a sample when ClickHouse fails', async () => {
      const { writeFile, files } = recordingWriter()
      const store = makeStore({ ch: new FakeClickHouse(), releasesFetcher: noReleases, writeFile })
      await store.regenerate()
      expect(files.has(peaksFile)).toBe(false)
    })
  })

  describe('real filesystem (default reader/writer)', () => {
    it('persists the peak history across store instances via the output dir', async () => {
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'e2m-badge-'))
      try {
        const make = (total: number, now: number) =>
          createBadgeStore({
            ch: buildFakeCh(total),
            appId: 'test-app',
            releasesApiUrl: 'https://example.com',
            outputDir: dir,
            releasesFetcher: noReleases,
            now: () => now,
          })
        await make(30, T0).regenerate() // no history file yet → ENOENT → fresh
        await make(4, T0 + HOUR).regenerate() // second instance loads the file
        const json = await fsp.readFile(path.join(dir, 'telemetry.json'), 'utf8')
        expect(peaksOf(json)['24h']).toEqual({ value: 30, at: new Date(T0).toISOString() })
      } finally {
        await fsp.rm(dir, { recursive: true, force: true })
      }
    })

    it('surfaces a non-ENOENT read error from the default reader instead of treating it as missing', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'e2m-badge-'))
      try {
        await fsp.mkdir(path.join(dir, 'peaks-history.json')) // a directory → EISDIR, not ENOENT
        const store = createBadgeStore({
          ch: buildFakeCh(3),
          appId: 'test-app',
          releasesApiUrl: 'https://example.com',
          outputDir: dir,
          releasesFetcher: noReleases,
          // no `now` → default clock
        })
        await store.regenerate()
        expect(error).toHaveBeenCalledWith(expect.stringContaining('peaks-history.json'), expect.any(Error))
        expect(peaksOf(await fsp.readFile(path.join(dir, 'telemetry.json'), 'utf8'))['24h']).toBeNull()
      } finally {
        await fsp.rm(dir, { recursive: true, force: true })
        error.mockRestore()
      }
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

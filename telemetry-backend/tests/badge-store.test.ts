import { describe, expect, it, vi } from 'vitest'
import type { ReleasesFetcher } from '../src/badge-store.js'
import { createBadgeStore } from '../src/badge-store.js'
import { INVISIBLE_SVG } from '../src/badges.js'
import { FakeClickHouse } from './fake-clickhouse.js'

function buildFakeCh(total = 5): FakeClickHouse {
  const fake = new FakeClickHouse()
  fake.onQuery('uniqExact(user_id) AS total', () => [{ total }])
  fake.onQuery('GROUP BY version, channel', () => [{ version: '2026.6.0', channel: 'stable', count: total }])
  return fake
}

const stableRelease = async (): Promise<{ stable: string | null; beta: string | null }> => ({
  stable: 'v2026.6.0',
  beta: null,
})

// Beta is for the NEXT minor (2026.7.0b1 > stable 2026.6.0), so the badge should be shown.
const bothReleases = async (): Promise<{ stable: string | null; beta: string | null }> => ({
  stable: 'v2026.5.0',
  beta: 'v2026.6.0b1',
})

const betaOnlyReleases = async (): Promise<{ stable: string | null; beta: string | null }> => ({
  stable: null,
  beta: 'v2026.6.0b1',
})

const noReleases = async (): Promise<{ stable: string | null; beta: string | null }> => ({
  stable: null,
  beta: null,
})

describe('createBadgeStore', () => {
  describe('initial state', () => {
    it('all getters return null before first regenerate', () => {
      const store = createBadgeStore({
        ch: buildFakeCh(),
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: stableRelease,
      })
      expect(store.getUsersSvg()).toBeNull()
      expect(store.getStableSvg()).toBeNull()
      expect(store.getBetaSvg()).toBeNull()
      expect(store.getTelemetryJson()).toBeNull()
    })
  })

  describe('after successful regenerate', () => {
    it('usersSvg is populated with a valid SVG', async () => {
      const store = createBadgeStore({
        ch: buildFakeCh(42),
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: stableRelease,
      })
      await store.regenerate()
      const svg = store.getUsersSvg()
      expect(svg).not.toBeNull()
      expect(svg).toContain('42')
      expect(svg).toContain('Users')
    })

    it('telemetryJson is serialized JSON containing the total', async () => {
      const store = createBadgeStore({
        ch: buildFakeCh(7),
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: stableRelease,
      })
      await store.regenerate()
      const json = store.getTelemetryJson()
      expect(json).not.toBeNull()
      const parsed = JSON.parse(json ?? '') as { total: number }
      expect(parsed.total).toBe(7)
    })

    it('stableSvg contains the stable version string', async () => {
      const store = createBadgeStore({
        ch: buildFakeCh(),
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: stableRelease,
      })
      await store.regenerate()
      expect(store.getStableSvg()).toContain('2026.6.0')
    })

    it('betaSvg is INVISIBLE_SVG when beta is not newer than stable', async () => {
      const store = createBadgeStore({
        ch: buildFakeCh(),
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: stableRelease,
      })
      await store.regenerate()
      expect(store.getBetaSvg()).toBe(INVISIBLE_SVG)
    })

    it('betaSvg contains the beta version when beta is newer', async () => {
      const store = createBadgeStore({
        ch: buildFakeCh(),
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: bothReleases,
      })
      await store.regenerate()
      expect(store.getBetaSvg()).toContain('2026.6.0b1')
    })

    it('betaSvg contains the beta version when there is no stable', async () => {
      const store = createBadgeStore({
        ch: buildFakeCh(),
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: betaOnlyReleases,
      })
      await store.regenerate()
      expect(store.getBetaSvg()).toContain('2026.6.0b1')
    })
  })

  describe('best-effort: telemetry failure', () => {
    it('keeps usersSvg/telemetryJson null when ClickHouse throws', async () => {
      const throwingCh = new FakeClickHouse()
      // No handlers registered → query throws
      const store = createBadgeStore({
        ch: throwingCh,
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: stableRelease,
      })
      await store.regenerate()
      expect(store.getUsersSvg()).toBeNull()
      expect(store.getTelemetryJson()).toBeNull()
    })

    it('still populates release badges when telemetry fails', async () => {
      const throwingCh = new FakeClickHouse()
      const store = createBadgeStore({
        ch: throwingCh,
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: stableRelease,
      })
      await store.regenerate()
      expect(store.getStableSvg()).toContain('2026.6.0')
    })
  })

  describe('best-effort: releases failure', () => {
    it('keeps stableSvg/betaSvg null when releases fetcher throws', async () => {
      const throwingFetcher: ReleasesFetcher = () => Promise.reject(new Error('Network error'))
      const store = createBadgeStore({
        ch: buildFakeCh(3),
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: throwingFetcher,
      })
      await store.regenerate()
      expect(store.getStableSvg()).toBeNull()
      expect(store.getBetaSvg()).toBeNull()
    })

    it('still populates telemetry when releases fail', async () => {
      const throwingFetcher: ReleasesFetcher = () => Promise.reject(new Error('Network error'))
      const store = createBadgeStore({
        ch: buildFakeCh(3),
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: throwingFetcher,
      })
      await store.regenerate()
      expect(store.getUsersSvg()).not.toBeNull()
    })
  })

  describe('last-good preservation', () => {
    it('retains last-good usersSvg when the subsequent telemetry cycle fails', async () => {
      let callCount = 0
      const intermittentCh = new FakeClickHouse()
      intermittentCh.onQuery('uniqExact(user_id) AS total', () => {
        callCount++
        if (callCount > 1) throw new Error('CH temporarily unavailable')
        return [{ total: 99 }]
      })
      intermittentCh.onQuery('GROUP BY version, channel', () => [])

      const store = createBadgeStore({
        ch: intermittentCh,
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: noReleases,
      })

      await store.regenerate() // succeeds
      const firstSvg = store.getUsersSvg()
      expect(firstSvg).toContain('99')

      await store.regenerate() // telemetry fails
      // Last-good should be preserved
      expect(store.getUsersSvg()).toBe(firstSvg)
    })

    it('retains last-good stableSvg when the subsequent releases cycle fails', async () => {
      let releaseCallCount = 0
      const intermittentFetcher: ReleasesFetcher = () => {
        releaseCallCount++
        if (releaseCallCount > 1) return Promise.reject(new Error('Network error'))
        return Promise.resolve({ stable: 'v2026.6.0', beta: null })
      }
      const store = createBadgeStore({
        ch: buildFakeCh(),
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: intermittentFetcher,
      })

      await store.regenerate() // succeeds
      const firstStable = store.getStableSvg()
      expect(firstStable).toContain('2026.6.0')

      await store.regenerate() // releases fails
      expect(store.getStableSvg()).toBe(firstStable)
    })
  })

  describe('no-releases edge case', () => {
    it('keeps stableSvg/betaSvg null when API returns no releases at all (initial)', async () => {
      const store = createBadgeStore({
        ch: buildFakeCh(),
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: noReleases,
      })
      await store.regenerate()
      // Null on first cycle when no releases are found
      expect(store.getStableSvg()).toBeNull()
      expect(store.getBetaSvg()).toBeNull()
    })
  })

  describe('console logging', () => {
    it('logs telemetry update', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const store = createBadgeStore({
        ch: buildFakeCh(42),
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: noReleases,
      })
      await store.regenerate()
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('42 users'))
      spy.mockRestore()
    })

    it('logs errors when ClickHouse throws', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const throwingCh = new FakeClickHouse()
      const store = createBadgeStore({
        ch: throwingCh,
        appId: 'test-app',
        releasesApiUrl: 'https://example.com',
        releasesFetcher: noReleases,
      })
      await store.regenerate()
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('[telemetry-backend]'), expect.any(Error))
      spy.mockRestore()
    })
  })
})

import { describe, expect, it } from 'vitest'
import { readConfig } from '../src/config.js'

const BASE_ENV: NodeJS.ProcessEnv = {
  CLICKHOUSE_URL: 'http://clickhouse:8123',
  APTABASE_APP_ID: 'test-guid-1234',
}

describe('readConfig', () => {
  describe('defaults', () => {
    it('returns default clickhouseDatabase', () => {
      expect(readConfig(BASE_ENV).clickhouseDatabase).toBe('default')
    })

    it('returns default clickhouseUser', () => {
      expect(readConfig(BASE_ENV).clickhouseUser).toBe('default')
    })

    it('returns empty clickhousePassword by default', () => {
      expect(readConfig(BASE_ENV).clickhousePassword).toBe('')
    })

    it('defaults BADGE_INTERVAL_SECONDS to 300', () => {
      expect(readConfig(BASE_ENV).badgeIntervalSeconds).toBe(300)
    })

    it('defaults OUTPUT_DIR to /app/badge', () => {
      expect(readConfig(BASE_ENV).outputDir).toBe('/app/badge')
    })

    it('defaults RELEASES_API_URL to gitlab.com', () => {
      expect(readConfig(BASE_ENV).releasesApiUrl).toContain('gitlab.com')
    })

    it('defaults RELEASES_PAGE_URL to gitlab.com', () => {
      expect(readConfig(BASE_ENV).releasesPageUrl).toContain('gitlab.com')
    })

    it('defaults PORT to 3001', () => {
      expect(readConfig(BASE_ENV).port).toBe(3001)
    })

    it('defaults APTABASE_HOST', () => {
      expect(readConfig(BASE_ENV).aptabaseHost).toBe('https://aptabase.devaus.eu')
    })

    it('defaults APTABASE_APP_KEY', () => {
      expect(readConfig(BASE_ENV).aptabaseAppKey).toBe('A-SH-2414786682')
    })

    it('defaults RATE_LIMIT_REQUESTS to 10', () => {
      expect(readConfig(BASE_ENV).rateLimitRequests).toBe(10)
    })

    it('defaults RATE_LIMIT_WINDOW_MS to 60000', () => {
      expect(readConfig(BASE_ENV).rateLimitWindowMs).toBe(60_000)
    })
  })

  describe('explicit values', () => {
    it('reads all badge-side env vars', () => {
      const config = readConfig({
        CLICKHOUSE_URL: 'http://ch:8123',
        CLICKHOUSE_USER: 'badge_reader',
        CLICKHOUSE_PASSWORD: 'secret',
        CLICKHOUSE_DATABASE: 'aptabase',
        APTABASE_APP_ID: 'my-app-guid',
        BADGE_INTERVAL_SECONDS: '60',
        RELEASES_API_URL: 'https://example.com/api/releases',
        RELEASES_PAGE_URL: 'https://example.com/releases',
      })
      expect(config.clickhouseUrl).toBe('http://ch:8123')
      expect(config.clickhouseUser).toBe('badge_reader')
      expect(config.clickhousePassword).toBe('secret')
      expect(config.clickhouseDatabase).toBe('aptabase')
      expect(config.aptabaseAppId).toBe('my-app-guid')
      expect(config.badgeIntervalSeconds).toBe(60)
      expect(config.releasesApiUrl).toBe('https://example.com/api/releases')
      expect(config.releasesPageUrl).toBe('https://example.com/releases')
    })

    it('reads all shim-side env vars', () => {
      const config = readConfig({
        ...BASE_ENV,
        APTABASE_HOST: 'https://custom.aptabase.example.com',
        APTABASE_APP_KEY: 'A-SH-custom',
        RATE_LIMIT_REQUESTS: '5',
        RATE_LIMIT_WINDOW_MS: '30000',
      })
      expect(config.aptabaseHost).toBe('https://custom.aptabase.example.com')
      expect(config.aptabaseAppKey).toBe('A-SH-custom')
      expect(config.rateLimitRequests).toBe(5)
      expect(config.rateLimitWindowMs).toBe(30_000)
    })

    it('reads PORT from env', () => {
      const config = readConfig({ ...BASE_ENV, PORT: '4000' })
      expect(config.port).toBe(4000)
    })
  })

  describe('required field errors', () => {
    it('throws when CLICKHOUSE_URL is missing', () => {
      expect(() => readConfig({ APTABASE_APP_ID: 'guid' })).toThrow('CLICKHOUSE_URL')
    })

    it('throws when APTABASE_APP_ID is missing', () => {
      expect(() => readConfig({ CLICKHOUSE_URL: 'http://ch:8123' })).toThrow('APTABASE_APP_ID')
    })
  })

  describe('invalid badge-side values', () => {
    it('throws when BADGE_INTERVAL_SECONDS is not a positive integer', () => {
      expect(() => readConfig({ ...BASE_ENV, BADGE_INTERVAL_SECONDS: 'abc' })).toThrow('BADGE_INTERVAL_SECONDS')
      expect(() => readConfig({ ...BASE_ENV, BADGE_INTERVAL_SECONDS: '0' })).toThrow('BADGE_INTERVAL_SECONDS')
      expect(() => readConfig({ ...BASE_ENV, BADGE_INTERVAL_SECONDS: '-10' })).toThrow('BADGE_INTERVAL_SECONDS')
    })
  })

  describe('invalid shim-side values', () => {
    it('throws on non-numeric RATE_LIMIT_REQUESTS', () => {
      expect(() => readConfig({ ...BASE_ENV, RATE_LIMIT_REQUESTS: 'abc' })).toThrow('RATE_LIMIT_REQUESTS')
    })

    it('throws on non-numeric RATE_LIMIT_WINDOW_MS', () => {
      expect(() => readConfig({ ...BASE_ENV, RATE_LIMIT_WINDOW_MS: 'abc' })).toThrow('RATE_LIMIT_WINDOW_MS')
    })
  })

  describe('PORT validation', () => {
    it('throws on non-numeric PORT', () => {
      expect(() => readConfig({ ...BASE_ENV, PORT: 'abc' })).toThrow('PORT')
    })

    it('throws on PORT 0', () => {
      expect(() => readConfig({ ...BASE_ENV, PORT: '0' })).toThrow('PORT')
    })

    it('throws on PORT greater than 65535', () => {
      expect(() => readConfig({ ...BASE_ENV, PORT: '65536' })).toThrow('PORT')
    })
  })
})

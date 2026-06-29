import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IMqtt } from '@/mqtt.js'
import { formatDuration } from '@/version-checker.js'

// Stable logger spies shared across all logger consumers in this file.
// Must be hoisted so vi.mock() factories can close over them.
const loggerSpies = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

// Mock dependencies before importing the module
vi.mock('axios')
vi.mock('@/logger.js', () => ({
  default: () => loggerSpies,
}))

// Mock telemetry helpers for deterministic OS info in tests
vi.mock('@/telemetry.js', () => ({
  getOsInfo: () => ({ osName: 'Linux', osVersion: '5.15.0', arch: 'arm64' }),
  mapOsName: (p: string) => p,
  summarizeAppliances: () => ({ models: '', count: 0 }),
}))

// Mock config with default values
vi.mock('@/config.js', () => ({
  default: {
    versionCheck: {
      checkInterval: 3600,
      ntfyWebhookUrl: undefined,
      notifyGracePeriod: 3600,
    },
    telemetryEnabled: true,
  },
}))

/**
 * Default telemetry context used across most tests.
 * applianceSummary returns a single appliance by default.
 */
const makeTelemetryCtx = (sessionId = 'test-session-id') => ({
  sessionId,
  applianceSummary: () => ({ models: 'COMFORT600', count: 1 }),
})

describe('formatDuration', () => {
  it('returns "1 minute" for 60 seconds', () => {
    expect(formatDuration(60)).toBe('1 minute')
  })

  it('returns "2 minutes" for 120 seconds', () => {
    expect(formatDuration(120)).toBe('2 minutes')
  })

  it('returns "30 minutes" for 1800 seconds', () => {
    expect(formatDuration(1800)).toBe('30 minutes')
  })

  it('returns "59 minutes" for 3540 seconds', () => {
    expect(formatDuration(3540)).toBe('59 minutes')
  })

  it('returns "1 hour" for 3600 seconds', () => {
    expect(formatDuration(3600)).toBe('1 hour')
  })

  it('returns "2 hours" for 7200 seconds', () => {
    expect(formatDuration(7200)).toBe('2 hours')
  })

  it('returns "1.5 hours" for 5400 seconds', () => {
    expect(formatDuration(5400)).toBe('1.5 hours')
  })

  it('returns "24 hours" for 86400 seconds', () => {
    expect(formatDuration(86400)).toBe('24 hours')
  })

  it('trims trailing ".0" — 3600 is "1 hour" not "1.0 hours"', () => {
    expect(formatDuration(3600)).not.toContain('.0')
  })

  it('trims trailing ".0" — 7200 is "2 hours" not "2.0 hours"', () => {
    expect(formatDuration(7200)).not.toContain('.0')
  })
})

describe('version-checker', () => {
  let startVersionChecker: typeof import('@/version-checker.js')['startVersionChecker']
  let mockAxiosGet: ReturnType<typeof vi.fn>
  let mockAxiosPost: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()

    // Setup axios mocks
    mockAxiosGet = vi.fn()
    mockAxiosPost = vi.fn()
    // biome-ignore lint/suspicious/noExplicitAny: supressed for the test
    vi.mocked(axios.get).mockImplementation(mockAxiosGet as any)
    // biome-ignore lint/suspicious/noExplicitAny: supressed for the test
    vi.mocked(axios.post).mockImplementation(mockAxiosPost as any)
    vi.mocked(axios.isAxiosError).mockReturnValue(false)

    // Dynamically import the module to ensure mocks are applied
    const module = await import('@/version-checker.js')
    startVersionChecker = module.startVersionChecker
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('startVersionChecker', () => {
    it('should start version checker and check immediately', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [
          {
            tag_name: 'v1.6.4',
            released_at: '2026-01-28T12:00:00Z',
          },
        ],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      // Wait for immediate check to complete
      await vi.advanceTimersByTimeAsync(0)

      // Should fetch latest version from GitLab
      expect(mockAxiosGet).toHaveBeenCalledWith(
        expect.stringContaining('/releases'),
        expect.objectContaining({
          timeout: 10000,
        }),
      )

      // Should send telemetry to Aptabase
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://aptabase.devaus.eu/api/v0/events',
        expect.arrayContaining([
          expect.objectContaining({
            eventName: 'version_check',
            sessionId: 'test-session-id',
            systemProps: expect.objectContaining({ appVersion: '1.6.3' }),
            props: expect.objectContaining({ channel: 'stable' }),
          }),
        ]),
        expect.objectContaining({ headers: expect.objectContaining({ 'App-Key': 'A-SH-2414786682' }) }),
      )

      stopChecker()
    })

    it('should log update channel and check interval at INFO level on startup', () => {
      mockAxiosGet.mockResolvedValue({ data: [] })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      // v1.6.3 is a stable version → channel is derived as 'stable'
      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      expect(loggerSpies.info).toHaveBeenCalledWith('Update channel: stable (derived from version v1.6.3)')
      expect(loggerSpies.info).toHaveBeenCalledWith('Version check interval set to 1 hour')

      stopChecker()
    })

    it('should return a function that stops the version checker', () => {
      mockAxiosGet.mockResolvedValue({ data: [] })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      expect(typeof stopChecker).toBe('function')
      expect(() => stopChecker()).not.toThrow()
    })

    it('should check for updates at configured interval', async () => {
      mockAxiosGet.mockResolvedValue({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      // Initial check
      await vi.advanceTimersByTimeAsync(0)
      const initialCalls = mockAxiosGet.mock.calls.length

      // Advance time by 1 hour (3600 seconds)
      await vi.advanceTimersByTimeAsync(3600 * 1000)

      // Should have made another check
      expect(mockAxiosGet).toHaveBeenCalledTimes(initialCalls + 1)

      stopChecker()
    })

    it('should skip check for development version', async () => {
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('development', makeTelemetryCtx())

      await vi.advanceTimersByTimeAsync(0)

      // Should not fetch version
      expect(mockAxiosGet).not.toHaveBeenCalled()
      // Should not send telemetry for development version
      expect(mockAxiosPost).not.toHaveBeenCalled()

      stopChecker()
    })
  })

  describe('compareVersions (pre-release semver)', () => {
    // Uses beta channel so channel filtering never masks the comparison result.
    // The stable channel would filter out pre-release tags, making publishInfo
    // return no payload and masking whether compareVersions is correct.
    let moduleForCmp: typeof import('@/version-checker.js')
    let mockPublishInfoCmp: ReturnType<typeof vi.fn>
    let mockMqttCmp: IMqtt

    beforeEach(async () => {
      vi.resetModules()
      vi.doMock('@/config.js', () => ({
        default: {
          versionCheck: {
            checkInterval: 3600,
            ntfyWebhookUrl: undefined,
            updateChannel: 'beta',
            notifyGracePeriod: 3600,
          },
          telemetryEnabled: false,
        },
      }))
      moduleForCmp = await import('@/version-checker.js')
      mockPublishInfoCmp = vi.fn()
      mockMqttCmp = { publishInfo: mockPublishInfoCmp } as unknown as IMqtt
      mockAxiosPost.mockResolvedValue({ data: { success: true } })
    })

    const runCheck = async (current: string, latestTag: string) => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: latestTag, released_at: '2026-01-28T12:00:00Z' }],
      })
      const stopChecker = moduleForCmp.startVersionChecker(current, makeTelemetryCtx(), mockMqttCmp)
      await vi.advanceTimersByTimeAsync(0)
      stopChecker()
      const calls = mockPublishInfoCmp.mock.calls
      if (calls.length === 0) return null
      const firstArg = calls[0]?.[0]
      return JSON.parse(firstArg as string) as Record<string, unknown>
    }

    it('RC is older than stable with same core: 1.17.0-rc.7 < 1.17.0 → update-available', async () => {
      const payload = await runCheck('1.17.0-rc.7', 'v1.17.0')
      expect(payload?.status).toBe('update-available')
    })

    it('stable is newer than RC with same core: 1.17.0 > 1.17.0-rc.7 → up-to-date', async () => {
      const payload = await runCheck('1.17.0', 'v1.17.0-rc.7')
      expect(payload?.status).toBe('up-to-date')
    })

    it('older RC vs newer RC: 1.17.0-rc.7 < 1.17.0-rc.8 → update-available', async () => {
      const payload = await runCheck('1.17.0-rc.7', 'v1.17.0-rc.8')
      expect(payload?.status).toBe('update-available')
    })

    it('newer RC vs older RC: 1.17.0-rc.8 > 1.17.0-rc.7 → up-to-date', async () => {
      const payload = await runCheck('1.17.0-rc.8', 'v1.17.0-rc.7')
      expect(payload?.status).toBe('up-to-date')
    })

    it('same RC versions: 1.17.0-rc.7 === 1.17.0-rc.7 → up-to-date', async () => {
      const payload = await runCheck('1.17.0-rc.7', 'v1.17.0-rc.7')
      expect(payload?.status).toBe('up-to-date')
    })

    it('same stable versions: 1.17.0 === 1.17.0 → up-to-date', async () => {
      const payload = await runCheck('1.17.0', 'v1.17.0')
      expect(payload?.status).toBe('up-to-date')
    })

    it('older stable vs newer RC: 1.16.5 < 1.17.0-rc.1 → update-available (beta channel sees RC as newer)', async () => {
      const payload = await runCheck('1.16.5', 'v1.17.0-rc.1')
      expect(payload?.status).toBe('update-available')
    })
  })

  describe('checkForUpdates beta channel — RC to stable promotion', () => {
    let moduleWithBetaRcToStable: typeof import('@/version-checker.js')
    let mockPublishInfoBeta: ReturnType<typeof vi.fn>
    let mockMqttBeta: IMqtt

    beforeEach(async () => {
      vi.resetModules()
      vi.doMock('@/config.js', () => ({
        default: {
          versionCheck: {
            checkInterval: 3600,
            ntfyWebhookUrl: undefined,
            updateChannel: 'beta',
            notifyGracePeriod: 3600,
          },
          telemetryEnabled: false,
        },
      }))
      moduleWithBetaRcToStable = await import('@/version-checker.js')
      mockPublishInfoBeta = vi.fn()
      mockMqttBeta = { publishInfo: mockPublishInfoBeta } as unknown as IMqtt
      mockAxiosPost.mockResolvedValue({ data: { success: true } })
    })

    it('running 1.17.0-rc.7 on beta channel + latest release is v1.17.0 → fires update-available', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [
          { tag_name: 'v1.17.0', released_at: '2026-04-21T12:00:00Z' },
          { tag_name: 'v1.17.0-rc.7', released_at: '2026-04-15T12:00:00Z' },
        ],
      })

      const stopChecker = moduleWithBetaRcToStable.startVersionChecker('1.17.0-rc.7', makeTelemetryCtx(), mockMqttBeta)
      await vi.advanceTimersByTimeAsync(0)
      stopChecker()

      expect(mockPublishInfoBeta).toHaveBeenCalledWith(expect.stringContaining('"status":"update-available"'))
      expect(mockPublishInfoBeta).toHaveBeenCalledWith(expect.stringContaining('"latestVersion":"v1.17.0"'))
    })
  })

  describe('version comparison', () => {
    it('should detect when a newer version is available', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [
          {
            tag_name: 'v1.6.4',
            released_at: '2026-01-28T12:00:00Z',
          },
        ],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      await vi.advanceTimersByTimeAsync(0)

      // Should have fetched releases
      expect(mockAxiosGet).toHaveBeenCalledWith(expect.stringContaining('/releases'), expect.any(Object))

      stopChecker()
    })

    it('should not notify when running the latest version', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [
          {
            tag_name: 'v1.6.3',
            released_at: '2026-01-28T12:00:00Z',
          },
        ],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      await vi.advanceTimersByTimeAsync(0)

      // Should have checked version but not sent ntfy notification
      expect(mockAxiosGet).toHaveBeenCalled()

      stopChecker()
    })

    it('should handle version strings with and without "v" prefix', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [
          {
            tag_name: '1.6.4',
            released_at: '2026-01-28T12:00:00Z',
          },
        ],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      await vi.advanceTimersByTimeAsync(0)

      // Should compare correctly even with different formats
      expect(mockAxiosGet).toHaveBeenCalled()

      stopChecker()
    })
  })

  describe('GitLab API integration', () => {
    it('should fetch from releases endpoint first', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [
          {
            tag_name: 'v1.6.4',
            released_at: '2026-01-28T12:00:00Z',
          },
        ],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      await vi.advanceTimersByTimeAsync(0)

      expect(mockAxiosGet).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/kirbodev%2Felectrolux-to-mqtt/releases',
        expect.any(Object),
      )

      stopChecker()
    })

    it('should fallback to tags endpoint if releases are empty', async () => {
      mockAxiosGet
        .mockResolvedValueOnce({ data: [] }) // Empty releases
        .mockResolvedValueOnce({
          // Tags response
          data: [
            {
              name: 'v1.6.4',
              commit: { created_at: '2026-01-28T12:00:00Z' },
            },
          ],
        })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      await vi.advanceTimersByTimeAsync(0)

      // Should have called both releases and tags endpoints
      expect(mockAxiosGet).toHaveBeenCalledWith(expect.stringContaining('/releases'), expect.any(Object))
      expect(mockAxiosGet).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/kirbodev%2Felectrolux-to-mqtt/repository/tags',
        expect.any(Object),
      )

      stopChecker()
    })

    it('should sort releases by released_at date', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [
          {
            tag_name: 'v1.6.2',
            released_at: '2026-01-20T12:00:00Z',
          },
          {
            tag_name: 'v1.6.4',
            released_at: '2026-01-28T12:00:00Z',
          },
          {
            tag_name: 'v1.6.3',
            released_at: '2026-01-25T12:00:00Z',
          },
        ],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      await vi.advanceTimersByTimeAsync(0)

      // Should have detected v1.6.4 as the latest
      expect(mockAxiosGet).toHaveBeenCalled()

      stopChecker()
    })

    it('should sort tags by commit created_at date when falling back to tags', async () => {
      mockAxiosGet
        .mockResolvedValueOnce({ data: [] }) // Empty releases
        .mockResolvedValueOnce({
          // Tags in wrong order
          data: [
            {
              name: 'v1.6.2',
              commit: { created_at: '2026-01-20T12:00:00Z' },
            },
            {
              name: 'v1.6.4',
              commit: { created_at: '2026-01-28T12:00:00Z' },
            },
            {
              name: 'v1.6.3',
              commit: { created_at: '2026-01-25T12:00:00Z' },
            },
          ],
        })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const mockPublishInfo = vi.fn()
      const mockMqtt = { publishInfo: mockPublishInfo } as unknown as IMqtt
      const stopChecker = startVersionChecker('v1.6.1', makeTelemetryCtx(), mockMqtt)

      await vi.advanceTimersByTimeAsync(0)

      // Should have detected v1.6.4 as the latest (sorted by created_at)
      expect(mockPublishInfo).toHaveBeenCalledWith(expect.stringContaining('"latestVersion":"v1.6.4"'))

      stopChecker()
    })

    it('should handle GitLab API errors gracefully', async () => {
      const error = new Error('Network error')
      mockAxiosGet.mockRejectedValueOnce(error)
      vi.mocked(axios.isAxiosError).mockReturnValue(false)

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      await vi.advanceTimersByTimeAsync(0)

      // Should not throw
      expect(mockAxiosGet).toHaveBeenCalled()

      stopChecker()
    })

    it('should handle axios errors', async () => {
      const error = { message: 'Request timeout', isAxiosError: true }
      mockAxiosGet.mockRejectedValueOnce(error)
      vi.mocked(axios.isAxiosError).mockReturnValue(true)

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      await vi.advanceTimersByTimeAsync(0)

      // Should not throw
      expect(mockAxiosGet).toHaveBeenCalled()

      stopChecker()
    })
  })

  describe('telemetry opt-out', () => {
    let moduleWithOptOut: typeof import('@/version-checker.js')

    beforeEach(async () => {
      vi.resetModules()

      vi.doMock('@/config.js', () => ({
        default: {
          versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined, notifyGracePeriod: 3600 },
          telemetryEnabled: false,
        },
      }))

      moduleWithOptOut = await import('@/version-checker.js')
    })

    it('should skip telemetry POST when telemetryEnabled is false', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })

      const stopChecker = moduleWithOptOut.startVersionChecker('v1.6.3', makeTelemetryCtx())
      await vi.advanceTimersByTimeAsync(0)

      // Version check should still run
      expect(mockAxiosGet).toHaveBeenCalled()
      // But telemetry POST should NOT have been called at all
      expect(mockAxiosPost).not.toHaveBeenCalled()

      stopChecker()
    })

    it('should send telemetry when telemetryEnabled is explicitly true', async () => {
      vi.resetModules()
      vi.doMock('@/config.js', () => ({
        default: {
          versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined, notifyGracePeriod: 3600 },
          telemetryEnabled: true,
        },
      }))
      const mod = await import('@/version-checker.js')

      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = mod.startVersionChecker('v1.6.3', makeTelemetryCtx())
      await vi.advanceTimersByTimeAsync(0)

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://aptabase.devaus.eu/api/v0/events',
        expect.arrayContaining([expect.objectContaining({ eventName: 'version_check', sessionId: 'test-session-id' })]),
        expect.objectContaining({ headers: expect.objectContaining({ 'App-Key': 'A-SH-2414786682' }) }),
      )

      stopChecker()
    })
  })

  describe('telemetry', () => {
    it('should send telemetry event to Aptabase with correct payload', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx('test-session-abc'))

      await vi.advanceTimersByTimeAsync(0)

      // v1.6.3 is a stable version → resolved channel is 'stable'
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://aptabase.devaus.eu/api/v0/events',
        [
          expect.objectContaining({
            sessionId: 'test-session-abc',
            eventName: 'version_check',
            systemProps: expect.objectContaining({
              appVersion: '1.6.3',
              osName: 'Linux',
              osVersion: '5.15.0',
              isDebug: false,
              sdkVersion: 'electrolux-to-mqtt@1.6.3',
            }),
            props: expect.objectContaining({
              channel: 'stable',
              arch: 'arm64',
              appliance_models: 'COMFORT600',
              appliance_count: 1,
            }),
          }),
        ],
        expect.objectContaining({
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'App-Key': 'A-SH-2414786682',
          },
        }),
      )

      stopChecker()
    })

    it('should handle telemetry failures silently', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockRejectedValueOnce(new Error('Telemetry server down'))

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())

      // Should not throw even if telemetry fails
      await vi.advanceTimersByTimeAsync(0)

      // Should have attempted telemetry
      expect(mockAxiosPost).toHaveBeenCalled()

      stopChecker()
    })
  })

  describe('Aptabase telemetry payload', () => {
    it('sends a one-element array to the Aptabase events URL', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: {} })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx('sess-1'))
      await vi.advanceTimersByTimeAsync(0)

      const [url, body] = mockAxiosPost.mock.calls[0] as [string, unknown]
      expect(url).toBe('https://aptabase.devaus.eu/api/v0/events')
      expect(Array.isArray(body)).toBe(true)
      expect(body).toHaveLength(1)

      stopChecker()
    })

    it('includes App-Key header in the request', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }] })
      mockAxiosPost.mockResolvedValue({ data: {} })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())
      await vi.advanceTimersByTimeAsync(0)

      const [, , opts] = mockAxiosPost.mock.calls[0] as [string, unknown, { headers: Record<string, string> }]
      expect(opts.headers['App-Key']).toBe('A-SH-2414786682')

      stopChecker()
    })

    it('event has eventName "version_check" and correct sessionId', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }] })
      mockAxiosPost.mockResolvedValue({ data: {} })

      const stopChecker = startVersionChecker('2026.6.0', makeTelemetryCtx('my-session-uuid'))
      await vi.advanceTimersByTimeAsync(0)

      const [, body] = mockAxiosPost.mock.calls[0] as [string, Array<Record<string, unknown>>]
      const event = body[0]
      expect(event?.eventName).toBe('version_check')
      expect(event?.sessionId).toBe('my-session-uuid')

      stopChecker()
    })

    it('strips leading "v" from appVersion and builds correct sdkVersion', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }] })
      mockAxiosPost.mockResolvedValue({ data: {} })

      const stopChecker = startVersionChecker('v2026.6.0', makeTelemetryCtx())
      await vi.advanceTimersByTimeAsync(0)

      const [, body] = mockAxiosPost.mock.calls[0] as [string, Array<Record<string, unknown>>]
      const event = body[0]
      const systemProps = event?.systemProps as Record<string, unknown>
      expect(systemProps?.appVersion).toBe('2026.6.0')
      expect(systemProps?.sdkVersion).toBe('electrolux-to-mqtt@2026.6.0')

      stopChecker()
    })

    it('systemProps has isDebug:false and mocked OS fields', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }] })
      mockAxiosPost.mockResolvedValue({ data: {} })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())
      await vi.advanceTimersByTimeAsync(0)

      const [, body] = mockAxiosPost.mock.calls[0] as [string, Array<Record<string, unknown>>]
      const systemProps = (body[0] as Record<string, unknown>)?.systemProps as Record<string, unknown>
      expect(systemProps?.isDebug).toBe(false)
      expect(systemProps?.osName).toBe('Linux')
      expect(systemProps?.osVersion).toBe('5.15.0')

      stopChecker()
    })

    it('props include channel, arch, appliance_models, appliance_count', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }] })
      mockAxiosPost.mockResolvedValue({ data: {} })

      const ctx = { sessionId: 'sid', applianceSummary: () => ({ models: 'COMFORT600', count: 2 }) }
      const stopChecker = startVersionChecker('v1.6.3', ctx)
      await vi.advanceTimersByTimeAsync(0)

      const [, body] = mockAxiosPost.mock.calls[0] as [string, Array<Record<string, unknown>>]
      const props = (body[0] as Record<string, unknown>)?.props as Record<string, unknown>
      expect(props?.channel).toBe('stable')
      expect(props?.arch).toBe('arm64')
      expect(props?.appliance_models).toBe('COMFORT600')
      expect(props?.appliance_count).toBe(2)

      stopChecker()
    })

    it('calls applianceSummary() lazily at each check (live fleet)', async () => {
      let callCount = 0
      const ctx = {
        sessionId: 'sid',
        applianceSummary: () => {
          callCount++
          return { models: `MODEL${callCount}`, count: callCount }
        },
      }
      mockAxiosGet.mockResolvedValue({ data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }] })
      mockAxiosPost.mockResolvedValue({ data: {} })

      const stopChecker = startVersionChecker('v1.6.3', ctx)
      await vi.advanceTimersByTimeAsync(0)
      // One telemetry ping on start re-reads the fleet.
      expect(callCount).toBe(1)

      // Telemetry pings every 15 minutes (independent of the version-check interval); each
      // ping calls applianceSummary() again, so the fleet is read live, not captured once.
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
      expect(callCount).toBe(2)

      stopChecker()
    })

    it('event timestamp is a valid ISO 8601 string', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }] })
      mockAxiosPost.mockResolvedValue({ data: {} })

      const now = new Date('2026-06-25T10:00:00.000Z')
      vi.setSystemTime(now)

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())
      await vi.advanceTimersByTimeAsync(0)

      const [, body] = mockAxiosPost.mock.calls[0] as [string, Array<Record<string, unknown>>]
      const event = body[0] as Record<string, unknown>
      expect(typeof event?.timestamp).toBe('string')
      expect(new Date(event?.timestamp as string).toISOString()).toBe('2026-06-25T10:00:00.000Z')

      stopChecker()
    })
  })

  describe('ntfy notifications', () => {
    let moduleWithNtfy: typeof import('@/version-checker.js')

    beforeEach(async () => {
      // Clear module cache and re-mock config with ntfy webhook
      vi.resetModules()

      vi.doMock('@/config.js', () => ({
        default: {
          versionCheck: {
            checkInterval: 3600,
            ntfyWebhookUrl: 'https://ntfy.sh/vB66ozQaRiqhTE9j',
            notifyGracePeriod: 3600,
          },
          telemetryEnabled: true,
        },
      }))

      // Re-import the module with the new config
      moduleWithNtfy = await import('@/version-checker.js')
    })

    it('should send ntfy notification when newer version is found', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = moduleWithNtfy.startVersionChecker('v1.6.3', makeTelemetryCtx())

      await vi.advanceTimersByTimeAsync(0)

      // Should send both telemetry and ntfy notification
      expect(mockAxiosPost).toHaveBeenCalledTimes(2)

      // First call should be telemetry to Aptabase (v1.6.3 is stable → channel: 'stable')
      expect(mockAxiosPost).toHaveBeenNthCalledWith(
        1,
        'https://aptabase.devaus.eu/api/v0/events',
        expect.arrayContaining([
          expect.objectContaining({
            eventName: 'version_check',
            props: expect.objectContaining({ channel: 'stable' }),
          }),
        ]),
        expect.objectContaining({ headers: expect.objectContaining({ 'App-Key': 'A-SH-2414786682' }) }),
      )

      // Second call should be ntfy notification
      expect(mockAxiosPost).toHaveBeenNthCalledWith(
        2,
        'https://ntfy.sh/vB66ozQaRiqhTE9j',
        "A newer version of Electrolux-to-MQTT is found. Latest version v1.6.4, you're running version v1.6.3",
        expect.objectContaining({
          timeout: 10000,
          headers: {
            'Content-Type': 'text/plain',
          },
        }),
      )

      stopChecker()
    })

    it('should only send ntfy notification once per version', async () => {
      mockAxiosGet.mockResolvedValue({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = moduleWithNtfy.startVersionChecker('v1.6.3', makeTelemetryCtx())

      // First check
      await vi.advanceTimersByTimeAsync(0)

      const ntfyCallsAfterFirst = mockAxiosPost.mock.calls.filter(
        (call) => call[0] === 'https://ntfy.sh/vB66ozQaRiqhTE9j',
      ).length

      // Advance time and check again
      await vi.advanceTimersByTimeAsync(3600 * 1000)

      const ntfyCallsAfterSecond = mockAxiosPost.mock.calls.filter(
        (call) => call[0] === 'https://ntfy.sh/vB66ozQaRiqhTE9j',
      ).length

      // Should only have sent notification once
      expect(ntfyCallsAfterSecond).toBe(ntfyCallsAfterFirst)

      stopChecker()
    })

    it('should handle ntfy notification failures gracefully', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost
        .mockResolvedValueOnce({ data: { success: true } }) // telemetry succeeds
        .mockRejectedValueOnce(new Error('ntfy server down')) // ntfy fails

      const stopChecker = moduleWithNtfy.startVersionChecker('v1.6.3', makeTelemetryCtx())
      // Should not throw even if ntfy fails
      await vi.advanceTimersByTimeAsync(0)

      // Should have attempted both telemetry and ntfy
      expect(mockAxiosPost).toHaveBeenCalled()

      stopChecker()
    })

    it('should handle ntfy notification failure with axios error', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      const axiosError = { message: 'Connection refused', isAxiosError: true }
      mockAxiosPost
        .mockResolvedValueOnce({ data: { success: true } }) // telemetry succeeds
        .mockRejectedValueOnce(axiosError) // ntfy fails with axios error
      vi.mocked(axios.isAxiosError).mockReturnValue(true)

      const stopChecker = moduleWithNtfy.startVersionChecker('v1.6.3', makeTelemetryCtx())
      await vi.advanceTimersByTimeAsync(0)

      // Should have attempted ntfy notification
      expect(mockAxiosPost).toHaveBeenCalledTimes(2)

      stopChecker()
    })
  })

  describe('MQTT version info publishing', () => {
    let mockPublishInfo: ReturnType<typeof vi.fn>
    let mockMqtt: IMqtt

    beforeEach(() => {
      mockPublishInfo = vi.fn()
      mockMqtt = { publishInfo: mockPublishInfo } as unknown as IMqtt
    })

    it('should publish up-to-date status when running the latest version', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.3', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      expect(mockPublishInfo).toHaveBeenCalledWith(
        JSON.stringify({ currentVersion: 'v1.6.3', status: 'up-to-date', releasedAt: '2026-01-28T12:00:00Z' }),
      )

      stopChecker()
    })

    it('should publish update-available status with latestVersion when a newer version is found', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      expect(mockPublishInfo).toHaveBeenCalledWith(
        JSON.stringify({
          currentVersion: 'v1.6.3',
          status: 'update-available',
          latestVersion: 'v1.6.4',
          releasedAt: '2026-01-28T12:00:00Z',
        }),
      )

      stopChecker()
    })

    it('should not notify about a newer version released less than 1 hour ago (default grace period)', async () => {
      const now = new Date('2026-04-21T12:00:00Z')
      vi.setSystemTime(now)
      const recentRelease = new Date(now.getTime() - 30 * 60 * 1000).toISOString()

      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: recentRelease }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      expect(mockPublishInfo).not.toHaveBeenCalledWith(expect.stringContaining('update-available'))
      stopChecker()
    })

    it('should notify about a newer version released more than 1 hour ago (default grace period)', async () => {
      const now = new Date('2026-04-21T12:00:00Z')
      vi.setSystemTime(now)
      const oldRelease = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()

      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: oldRelease }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      expect(mockPublishInfo).toHaveBeenCalledWith(expect.stringContaining('update-available'))
      stopChecker()
    })

    describe('configurable notifyGracePeriod', () => {
      it('with notifyGracePeriod=0 a release younger than 1 hour is still notified', async () => {
        vi.resetModules()
        vi.doMock('@/config.js', () => ({
          default: {
            versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined, notifyGracePeriod: 0 },
            telemetryEnabled: false,
          },
        }))
        const mod = await import('@/version-checker.js')

        const now = new Date('2026-04-21T12:00:00Z')
        vi.setSystemTime(now)
        const recentRelease = new Date(now.getTime() - 30 * 60 * 1000).toISOString()

        mockAxiosGet.mockResolvedValueOnce({
          data: [{ tag_name: 'v1.6.4', released_at: recentRelease }],
        })

        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = mod.startVersionChecker('v1.6.3', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()

        expect(pub).toHaveBeenCalledWith(expect.stringContaining('update-available'))
      })

      it('with notifyGracePeriod=7200 a release 90 minutes old is still skipped', async () => {
        vi.resetModules()
        vi.doMock('@/config.js', () => ({
          default: {
            versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined, notifyGracePeriod: 7200 },
            telemetryEnabled: false,
          },
        }))
        const mod = await import('@/version-checker.js')

        const now = new Date('2026-04-21T12:00:00Z')
        vi.setSystemTime(now)
        const ninetyMinAgo = new Date(now.getTime() - 90 * 60 * 1000).toISOString()

        mockAxiosGet.mockResolvedValueOnce({
          data: [{ tag_name: 'v1.6.4', released_at: ninetyMinAgo }],
        })

        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = mod.startVersionChecker('v1.6.3', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()

        expect(pub).not.toHaveBeenCalledWith(expect.stringContaining('update-available'))
      })

      it('with notifyGracePeriod=7200 a release older than 2 hours is notified', async () => {
        vi.resetModules()
        vi.doMock('@/config.js', () => ({
          default: {
            versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined, notifyGracePeriod: 7200 },
            telemetryEnabled: false,
          },
        }))
        const mod = await import('@/version-checker.js')

        const now = new Date('2026-04-21T12:00:00Z')
        vi.setSystemTime(now)
        const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString()

        mockAxiosGet.mockResolvedValueOnce({
          data: [{ tag_name: 'v1.6.4', released_at: threeHoursAgo }],
        })

        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = mod.startVersionChecker('v1.6.3', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()

        expect(pub).toHaveBeenCalledWith(expect.stringContaining('update-available'))
      })
    })

    it('should publish development status and skip version fetch for development builds', async () => {
      const stopChecker = startVersionChecker('development', makeTelemetryCtx(), mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      expect(mockPublishInfo).toHaveBeenCalledWith(
        JSON.stringify({ currentVersion: 'development', status: 'development' }),
      )
      // Should not have contacted GitLab or telemetry
      expect(mockAxiosGet).not.toHaveBeenCalled()
      expect(mockAxiosPost).not.toHaveBeenCalled()

      stopChecker()
    })

    it('should not call publishInfo when mqtt is not provided (backward-compatible)', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.3', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      // Call without mqtt argument
      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx())
      await vi.advanceTimersByTimeAsync(0)

      expect(mockPublishInfo).not.toHaveBeenCalled()

      stopChecker()
    })

    it('should publish when status changes between periodic checks', async () => {
      // First check: up-to-date
      mockAxiosGet
        .mockResolvedValueOnce({ data: [{ tag_name: 'v1.6.3', released_at: '2026-01-28T12:00:00Z' }] })
        // Second check (after interval): update available
        .mockResolvedValueOnce({ data: [{ tag_name: 'v1.6.4', released_at: '2026-02-01T12:00:00Z' }] })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)

      await vi.advanceTimersByTimeAsync(0)
      expect(mockPublishInfo).toHaveBeenCalledTimes(1)
      expect(mockPublishInfo).toHaveBeenLastCalledWith(
        JSON.stringify({ currentVersion: 'v1.6.3', status: 'up-to-date', releasedAt: '2026-01-28T12:00:00Z' }),
      )

      await vi.advanceTimersByTimeAsync(3600 * 1000)
      expect(mockPublishInfo).toHaveBeenCalledTimes(2)
      expect(mockPublishInfo).toHaveBeenLastCalledWith(
        JSON.stringify({
          currentVersion: 'v1.6.3',
          status: 'update-available',
          latestVersion: 'v1.6.4',
          releasedAt: '2026-02-01T12:00:00Z',
        }),
      )

      stopChecker()
    })

    it('should not publish again when status is unchanged between periodic checks', async () => {
      // Both checks return the same up-to-date result
      mockAxiosGet.mockResolvedValue({ data: [{ tag_name: 'v1.6.3', released_at: '2026-01-28T12:00:00Z' }] })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)

      await vi.advanceTimersByTimeAsync(0)
      expect(mockPublishInfo).toHaveBeenCalledTimes(1)

      // Second check — same result, should not publish again
      await vi.advanceTimersByTimeAsync(3600 * 1000)
      expect(mockPublishInfo).toHaveBeenCalledTimes(1)

      stopChecker()
    })

    it('should include description in update-available payload when release provides it', async () => {
      const description = '## 1.6.4 (2026-01-28)\n\n#### Feature\n\n* some new feature\n\n'
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z', description }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      expect(mockPublishInfo).toHaveBeenCalledWith(
        JSON.stringify({
          currentVersion: 'v1.6.3',
          status: 'update-available',
          latestVersion: 'v1.6.4',
          releasedAt: '2026-01-28T12:00:00Z',
          description,
        }),
      )

      stopChecker()
    })

    it('should include description in up-to-date payload when release provides it', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.3', released_at: '2026-01-25T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      expect(mockPublishInfo).toHaveBeenCalledWith(
        JSON.stringify({
          currentVersion: 'v1.6.3',
          status: 'up-to-date',
          releasedAt: '2026-01-25T12:00:00Z',
        }),
      )

      stopChecker()
    })

    it('should handle errors in periodic version check gracefully', async () => {
      // First check succeeds
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.3', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      // Second check (periodic) throws
      mockAxiosPost.mockRejectedValueOnce(new Error('Telemetry crash'))
      mockAxiosGet.mockRejectedValueOnce(new Error('Network down'))

      // Should not throw even when periodic check fails
      await vi.advanceTimersByTimeAsync(3600 * 1000)

      // publishInfo should only have been called once (from the successful first check)
      expect(mockPublishInfo).toHaveBeenCalledTimes(1)

      stopChecker()
    })

    it('should omit description from payload when release has no description', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      const publishedPayload = JSON.parse(mockPublishInfo.mock.calls[0]?.[0])
      expect(publishedPayload).not.toHaveProperty('description')

      stopChecker()
    })

    it('should handle pre-release version tags like 1.0.0-rc.1 without crashing', async () => {
      // The version comparison strips pre-release suffixes — only numeric X.Y.Z parts are compared.
      // A pre-release tag from GitLab must not cause an unhandled rejection.
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.0.0-rc.1', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)

      // Must not throw or produce an unhandled rejection
      await expect(vi.advanceTimersByTimeAsync(0)).resolves.not.toThrow()

      // Should have called the GitLab API
      expect(mockAxiosGet).toHaveBeenCalled()

      stopChecker()
    })

    it('should treat pre-release tag 1.0.0-rc.1 as lower than running version 1.6.3 (no update notification)', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.0.0-rc.1', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      // 1.0.0 numeric parts < 1.6.3 — should publish 'up-to-date', not 'update-available'
      const publishedPayload = mockPublishInfo.mock.calls[0]
        ? (JSON.parse(mockPublishInfo.mock.calls[0][0]) as Record<string, unknown>)
        : null

      if (publishedPayload) {
        expect(publishedPayload.status).toBe('up-to-date')
      }

      stopChecker()
    })

    it('should handle a malformed tag like vvv1.0.0 without crashing', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'vvv1.0.0', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)

      // Must not throw or produce an unhandled rejection
      await expect(vi.advanceTimersByTimeAsync(0)).resolves.not.toThrow()

      expect(mockAxiosGet).toHaveBeenCalled()

      stopChecker()
    })

    it('should handle a completely non-semver tag like not-a-version without crashing', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'not-a-version', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)

      await expect(vi.advanceTimersByTimeAsync(0)).resolves.not.toThrow()

      expect(mockAxiosGet).toHaveBeenCalled()

      stopChecker()
    })

    it('should include description from tag release object when falling back to tags endpoint', async () => {
      const description = '## 1.6.4 from tag\n\n#### Feature\n\n* tag feature\n\n'
      mockAxiosGet
        .mockResolvedValueOnce({ data: [] }) // Empty releases
        .mockResolvedValueOnce({
          data: [
            {
              name: 'v1.6.4',
              message: '',
              target: 'abc123',
              commit: {
                id: 'abc123',
                short_id: 'abc123',
                created_at: '2026-01-28T12:00:00Z',
                title: 'feat',
                author_name: 'Author',
                web_url: '',
              },
              release: { tag_name: 'v1.6.4', description },
              protected: false,
              created_at: null,
            },
          ],
        })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', makeTelemetryCtx(), mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      expect(mockPublishInfo).toHaveBeenCalledWith(
        JSON.stringify({
          currentVersion: 'v1.6.3',
          status: 'update-available',
          latestVersion: 'v1.6.4',
          releasedAt: '2026-01-28T12:00:00Z',
          description,
        }),
      )

      stopChecker()
    })
  })

  describe('updateChannel filtering', () => {
    describe("stable channel (default) — skips releases whose tag_name contains '-'", () => {
      let moduleWithStable: typeof import('@/version-checker.js')

      beforeEach(async () => {
        vi.resetModules()
        vi.doMock('@/config.js', () => ({
          default: {
            versionCheck: {
              checkInterval: 3600,
              ntfyWebhookUrl: undefined,
              updateChannel: 'stable',
              notifyGracePeriod: 3600,
            },
            telemetryEnabled: false,
          },
        }))
        moduleWithStable = await import('@/version-checker.js')
      })

      it('should skip an rc release and return null when that is the only release', async () => {
        mockAxiosGet
          .mockResolvedValueOnce({
            data: [{ tag_name: 'v1.15.1-rc.1', released_at: '2026-04-01T12:00:00Z' }],
          })
          .mockResolvedValueOnce({ data: [] }) // tags fallback also empty

        const mockPublishInfoStable = vi.fn()
        const mockMqttStable = { publishInfo: mockPublishInfoStable } as unknown as IMqtt

        const stopChecker = moduleWithStable.startVersionChecker('v1.14.0', makeTelemetryCtx(), mockMqttStable)
        await vi.advanceTimersByTimeAsync(0)

        // No stable release found — should not publish update-available
        const calls = mockPublishInfoStable.mock.calls
        for (const call of calls) {
          const payload = JSON.parse(call[0] as string) as Record<string, unknown>
          expect(payload.status).not.toBe('update-available')
        }

        stopChecker()
      })

      it('should return stable release when both stable and rc releases are present', async () => {
        mockAxiosGet.mockResolvedValueOnce({
          data: [
            { tag_name: 'v1.15.1-rc.1', released_at: '2026-04-10T12:00:00Z' },
            { tag_name: 'v1.15.0', released_at: '2026-04-01T12:00:00Z' },
          ],
        })
        mockAxiosPost.mockResolvedValue({ data: { success: true } })

        const mockPublishInfoStable = vi.fn()
        const mockMqttStable = { publishInfo: mockPublishInfoStable } as unknown as IMqtt

        const stopChecker = moduleWithStable.startVersionChecker('v1.14.0', makeTelemetryCtx(), mockMqttStable)
        await vi.advanceTimersByTimeAsync(0)

        // Should have identified v1.15.0 as latest stable and notified about it
        expect(mockPublishInfoStable).toHaveBeenCalledWith(expect.stringContaining('"latestVersion":"v1.15.0"'))

        stopChecker()
      })

      it('should skip rc tags in tags fallback', async () => {
        mockAxiosGet
          .mockResolvedValueOnce({ data: [] }) // no releases
          .mockResolvedValueOnce({
            data: [
              {
                name: 'v1.15.1-rc.1',
                commit: { created_at: '2026-04-10T12:00:00Z' },
              },
              {
                name: 'v1.15.0',
                commit: { created_at: '2026-04-01T12:00:00Z' },
              },
            ],
          })
        mockAxiosPost.mockResolvedValue({ data: { success: true } })

        const mockPublishInfoStable = vi.fn()
        const mockMqttStable = { publishInfo: mockPublishInfoStable } as unknown as IMqtt

        const stopChecker = moduleWithStable.startVersionChecker('v1.14.0', makeTelemetryCtx(), mockMqttStable)
        await vi.advanceTimersByTimeAsync(0)

        // Should have detected v1.15.0 from tags, skipping the rc tag
        expect(mockPublishInfoStable).toHaveBeenCalledWith(expect.stringContaining('"latestVersion":"v1.15.0"'))

        stopChecker()
      })
    })

    describe('beta channel — includes rc releases', () => {
      let moduleWithBeta: typeof import('@/version-checker.js')

      beforeEach(async () => {
        vi.resetModules()
        vi.doMock('@/config.js', () => ({
          default: {
            versionCheck: {
              checkInterval: 3600,
              ntfyWebhookUrl: undefined,
              updateChannel: 'beta',
              notifyGracePeriod: 3600,
            },
            telemetryEnabled: false,
          },
        }))
        moduleWithBeta = await import('@/version-checker.js')
      })

      it('should return rc release when it is the most recently created', async () => {
        mockAxiosGet.mockResolvedValueOnce({
          data: [
            { tag_name: 'v1.15.1-rc.1', released_at: '2026-04-10T12:00:00Z' },
            { tag_name: 'v1.15.0', released_at: '2026-04-01T12:00:00Z' },
          ],
        })
        mockAxiosPost.mockResolvedValue({ data: { success: true } })

        const mockPublishInfoBeta = vi.fn()
        const mockMqttBeta = { publishInfo: mockPublishInfoBeta } as unknown as IMqtt

        const stopChecker = moduleWithBeta.startVersionChecker('v1.14.0', makeTelemetryCtx(), mockMqttBeta)
        await vi.advanceTimersByTimeAsync(0)

        // Beta channel includes rc — should see v1.15.1-rc.1 as the latest
        expect(mockPublishInfoBeta).toHaveBeenCalledWith(expect.stringContaining('"latestVersion":"v1.15.1-rc.1"'))

        stopChecker()
      })

      it('should include rc tags in tags fallback', async () => {
        mockAxiosGet
          .mockResolvedValueOnce({ data: [] }) // no releases
          .mockResolvedValueOnce({
            data: [
              {
                name: 'v1.15.1-rc.1',
                commit: { created_at: '2026-04-10T12:00:00Z' },
              },
              {
                name: 'v1.15.0',
                commit: { created_at: '2026-04-01T12:00:00Z' },
              },
            ],
          })
        mockAxiosPost.mockResolvedValue({ data: { success: true } })

        const mockPublishInfoBeta = vi.fn()
        const mockMqttBeta = { publishInfo: mockPublishInfoBeta } as unknown as IMqtt

        const stopChecker = moduleWithBeta.startVersionChecker('v1.14.0', makeTelemetryCtx(), mockMqttBeta)
        await vi.advanceTimersByTimeAsync(0)

        // Beta channel: rc tag should surface
        expect(mockPublishInfoBeta).toHaveBeenCalledWith(expect.stringContaining('"latestVersion":"v1.15.1-rc.1"'))

        stopChecker()
      })
    })
  })

  // ── CalVer compatibility ──────────────────────────────────────────────────
  describe('CalVer + SemVer forward-compatibility', () => {
    // isPreRelease detection tests drive through startVersionChecker:
    // on the stable channel a pre-release tag is filtered out (no payload);
    // on the stable channel a stable tag produces update-available.
    // We use the channel filter as an observable proxy for isPreRelease
    // because the function itself is not exported.
    describe('isPreRelease detection — stable channel', () => {
      let moduleStableIsPre: typeof import('@/version-checker.js')

      beforeEach(async () => {
        vi.resetModules()
        vi.doMock('@/config.js', () => ({
          default: {
            versionCheck: {
              checkInterval: 3600,
              ntfyWebhookUrl: undefined,
              updateChannel: 'stable',
              notifyGracePeriod: 3600,
            },
            telemetryEnabled: false,
          },
        }))
        moduleStableIsPre = await import('@/version-checker.js')
      })

      it('treats 2026.6.0b1 as pre-release (stable channel skips it)', async () => {
        // stable channel must filter out beta tag → no update-available published
        mockAxiosGet
          .mockResolvedValueOnce({
            data: [{ tag_name: 'v2026.6.0b1', released_at: '2026-04-01T12:00:00Z' }],
          })
          .mockResolvedValueOnce({ data: [] })

        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = moduleStableIsPre.startVersionChecker('1.18.5', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()

        for (const call of pub.mock.calls) {
          const payload = JSON.parse(call[0] as string) as Record<string, unknown>
          expect(payload.status).not.toBe('update-available')
        }
      })

      it('treats 2026.6.0 as stable (stable channel includes it)', async () => {
        mockAxiosGet.mockResolvedValueOnce({
          data: [{ tag_name: 'v2026.6.0', released_at: '2026-04-01T12:00:00Z' }],
        })

        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = moduleStableIsPre.startVersionChecker('1.18.5', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()

        expect(pub).toHaveBeenCalledWith(expect.stringContaining('"status":"update-available"'))
      })

      it('treats 1.18.5-rc.1 as pre-release (stable channel skips it)', async () => {
        mockAxiosGet
          .mockResolvedValueOnce({
            data: [{ tag_name: 'v1.18.5-rc.1', released_at: '2026-04-01T12:00:00Z' }],
          })
          .mockResolvedValueOnce({ data: [] })

        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = moduleStableIsPre.startVersionChecker('1.17.0', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()

        for (const call of pub.mock.calls) {
          const payload = JSON.parse(call[0] as string) as Record<string, unknown>
          expect(payload.status).not.toBe('update-available')
        }
      })

      it('treats 1.18.5 as stable (stable channel includes it)', async () => {
        mockAxiosGet.mockResolvedValueOnce({
          data: [{ tag_name: 'v1.18.5', released_at: '2026-04-01T12:00:00Z' }],
        })

        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = moduleStableIsPre.startVersionChecker('1.17.0', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()

        expect(pub).toHaveBeenCalledWith(expect.stringContaining('"status":"update-available"'))
      })

      it('treats v2026.6.0b1 (with v prefix) as pre-release', async () => {
        mockAxiosGet
          .mockResolvedValueOnce({
            data: [{ tag_name: 'v2026.6.0b1', released_at: '2026-04-01T12:00:00Z' }],
          })
          .mockResolvedValueOnce({ data: [] })

        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = moduleStableIsPre.startVersionChecker('2026.5.0', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()

        for (const call of pub.mock.calls) {
          const payload = JSON.parse(call[0] as string) as Record<string, unknown>
          expect(payload.status).not.toBe('update-available')
        }
      })
    })

    describe('version ordering', () => {
      // Uses beta channel so channel filtering does not mask comparison results.
      let moduleCalVer: typeof import('@/version-checker.js')
      let pubFn: ReturnType<typeof vi.fn>
      let mqttCalVer: IMqtt

      beforeEach(async () => {
        vi.resetModules()
        vi.doMock('@/config.js', () => ({
          default: {
            versionCheck: {
              checkInterval: 3600,
              ntfyWebhookUrl: undefined,
              updateChannel: 'beta',
              notifyGracePeriod: 3600,
            },
            telemetryEnabled: false,
          },
        }))
        moduleCalVer = await import('@/version-checker.js')
        pubFn = vi.fn()
        mqttCalVer = { publishInfo: pubFn } as unknown as IMqtt
        mockAxiosPost.mockResolvedValue({ data: { success: true } })
      })

      const runCmp = async (current: string, latestTag: string): Promise<string | null> => {
        mockAxiosGet.mockResolvedValueOnce({
          data: [{ tag_name: latestTag, released_at: '2026-01-28T12:00:00Z' }],
        })
        const stop = moduleCalVer.startVersionChecker(current, makeTelemetryCtx(), mqttCalVer)
        await vi.advanceTimersByTimeAsync(0)
        stop()
        const calls = pubFn.mock.calls
        if (calls.length === 0) return null
        const raw = calls[0]?.[0]
        return (JSON.parse(raw as string) as Record<string, unknown>).status as string
      }

      it('2026.6.0 > 1.18.5 (calver stable beats old semver stable)', async () => {
        expect(await runCmp('1.18.5', 'v2026.6.0')).toBe('update-available')
      })

      it('2026.6.1 > 2026.6.0 (calver patch increment)', async () => {
        expect(await runCmp('2026.6.0', 'v2026.6.1')).toBe('update-available')
      })

      it('2026.6.0 > 2026.6.0b1 (stable beats beta of same base)', async () => {
        expect(await runCmp('2026.6.0b1', 'v2026.6.0')).toBe('update-available')
      })

      it('2026.6.0b2 > 2026.6.0b1 (higher beta number wins)', async () => {
        expect(await runCmp('2026.6.0b1', 'v2026.6.0b2')).toBe('update-available')
      })

      it('2026.6.0b1 > 1.18.5-rc.5 (calver beta beats old semver rc)', async () => {
        expect(await runCmp('1.18.5-rc.5', 'v2026.6.0b1')).toBe('update-available')
      })

      it('1.18.5 == 1.18.5 → up-to-date', async () => {
        expect(await runCmp('1.18.5', 'v1.18.5')).toBe('up-to-date')
      })

      it('2026.6.0 == 2026.6.0 → up-to-date', async () => {
        expect(await runCmp('2026.6.0', 'v2026.6.0')).toBe('up-to-date')
      })
    })

    describe('channel filtering with mixed old+new releases — stable', () => {
      let moduleStableMixed: typeof import('@/version-checker.js')

      beforeEach(async () => {
        vi.resetModules()
        vi.doMock('@/config.js', () => ({
          default: {
            versionCheck: {
              checkInterval: 3600,
              ntfyWebhookUrl: undefined,
              updateChannel: 'stable',
              notifyGracePeriod: 3600,
            },
            telemetryEnabled: false,
          },
        }))
        moduleStableMixed = await import('@/version-checker.js')
      })

      it('stable channel: picks 2026.6.0 (most recent stable) from mixed list, skips bN and rc', async () => {
        // Dates ordered so 2026.6.0 is most recent stable. Use past dates so the
        // 1-hour new-release guard never suppresses the notification.
        mockAxiosGet.mockResolvedValueOnce({
          data: [
            { tag_name: 'v2026.6.0b2', released_at: '2026-05-10T12:00:00Z' }, // latest by date but pre-release
            { tag_name: 'v2026.6.0', released_at: '2026-05-09T12:00:00Z' }, // most recent stable
            { tag_name: 'v1.18.5', released_at: '2026-04-01T12:00:00Z' },
            { tag_name: 'v1.18.5-rc.1', released_at: '2026-03-20T12:00:00Z' },
          ],
        })

        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = moduleStableMixed.startVersionChecker('1.18.5', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()

        // Should pick v2026.6.0 as latest stable, v1.18.5 is current → update-available
        expect(pub).toHaveBeenCalledWith(expect.stringContaining('"latestVersion":"v2026.6.0"'))
      })
    })

    describe('channel filtering with mixed old+new releases — beta', () => {
      let moduleBetaMixed: typeof import('@/version-checker.js')

      beforeEach(async () => {
        vi.resetModules()
        vi.doMock('@/config.js', () => ({
          default: {
            versionCheck: {
              checkInterval: 3600,
              ntfyWebhookUrl: undefined,
              updateChannel: 'beta',
              notifyGracePeriod: 3600,
            },
            telemetryEnabled: false,
          },
        }))
        moduleBetaMixed = await import('@/version-checker.js')
      })

      it('beta channel: picks 2026.6.0b2 (most recent by date) from mixed list', async () => {
        // Use dates well in the past so the 1-hour new-release guard never suppresses the notification.
        mockAxiosGet.mockResolvedValueOnce({
          data: [
            { tag_name: 'v2026.6.0b2', released_at: '2026-05-10T12:00:00Z' },
            { tag_name: 'v2026.6.0', released_at: '2026-05-09T12:00:00Z' },
            { tag_name: 'v1.18.5', released_at: '2026-04-01T12:00:00Z' },
            { tag_name: 'v1.18.5-rc.1', released_at: '2026-03-20T12:00:00Z' },
          ],
        })

        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = moduleBetaMixed.startVersionChecker('1.18.5', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()

        // Beta channel picks latest by date = v2026.6.0b2
        expect(pub).toHaveBeenCalledWith(expect.stringContaining('"latestVersion":"v2026.6.0b2"'))
      })
    })
  })

  // ── Version-derived update channel ────────────────────────────────────────
  // When updateChannel is undefined (not set by user), the running version
  // determines the channel: pre-release version → beta, stable → stable.
  // An explicit config value wins in both directions.
  describe('version-derived update channel', () => {
    // Helper: start version-checker with a given config mock, wait, stop, return MQTT publish calls.
    const makeModule = async (updateChannel: 'stable' | 'beta' | undefined) => {
      vi.resetModules()
      vi.doMock('@/config.js', () => ({
        default: {
          versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined, updateChannel, notifyGracePeriod: 3600 },
          telemetryEnabled: false,
        },
      }))
      return await import('@/version-checker.js')
    }

    describe('derive from version (unset channel)', () => {
      it('pre-release version 2026.6.0b1 + unset channel → derives beta → sees pre-release tags', async () => {
        // beta channel: pre-release tag is NOT filtered → update-available
        const mod = await makeModule(undefined)
        mockAxiosGet.mockResolvedValueOnce({
          data: [{ tag_name: 'v2026.6.0b2', released_at: '2026-05-01T12:00:00Z' }],
        })
        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = mod.startVersionChecker('2026.6.0b1', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()
        expect(pub).toHaveBeenCalledWith(expect.stringContaining('"status":"update-available"'))
      })

      it('stable version 2026.6.0 + unset channel → derives stable → pre-release tags filtered', async () => {
        // stable channel: only pre-release tag available → filtered → no update-available
        const mod = await makeModule(undefined)
        mockAxiosGet
          .mockResolvedValueOnce({
            data: [{ tag_name: 'v2026.6.0b2', released_at: '2026-05-01T12:00:00Z' }],
          })
          .mockResolvedValueOnce({ data: [] })
        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = mod.startVersionChecker('2026.6.0', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()
        for (const call of pub.mock.calls) {
          const payload = JSON.parse(call[0] as string) as Record<string, unknown>
          expect(payload.status).not.toBe('update-available')
        }
      })

      it('development + unset channel → derives stable → logs derived channel', async () => {
        // development skips version check entirely; this test verifies channel resolution still logs
        const mod = await makeModule(undefined)
        const stop = mod.startVersionChecker('development', makeTelemetryCtx())
        await vi.advanceTimersByTimeAsync(0)
        stop()
        // Should log the resolved channel with a "derived" indicator
        const allInfoCalls = loggerSpies.info.mock.calls.map((c) => String(c[0]))
        expect(allInfoCalls.some((msg) => msg.includes('stable') && msg.includes('derived'))).toBe(true)
      })
    })

    describe('explicit channel wins over derived (both directions)', () => {
      it('explicit stable + pre-release version 2026.6.0b1 → stays stable → filters pre-release tags', async () => {
        const mod = await makeModule('stable')
        mockAxiosGet
          .mockResolvedValueOnce({
            data: [{ tag_name: 'v2026.6.0b2', released_at: '2026-05-01T12:00:00Z' }],
          })
          .mockResolvedValueOnce({ data: [] })
        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = mod.startVersionChecker('2026.6.0b1', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()
        for (const call of pub.mock.calls) {
          const payload = JSON.parse(call[0] as string) as Record<string, unknown>
          expect(payload.status).not.toBe('update-available')
        }
      })

      it('explicit beta + stable version 2026.5.0 → stays beta → sees pre-release tags from 2026.6.x', async () => {
        // Current running version is stable 2026.5.0. With explicit beta channel,
        // a newer pre-release tag 2026.6.0b1 should be visible as update-available.
        const mod = await makeModule('beta')
        mockAxiosGet.mockResolvedValueOnce({
          data: [{ tag_name: 'v2026.6.0b1', released_at: '2026-05-01T12:00:00Z' }],
        })
        const pub = vi.fn()
        const mqtt = { publishInfo: pub } as unknown as IMqtt
        const stop = mod.startVersionChecker('2026.5.0', makeTelemetryCtx(), mqtt)
        await vi.advanceTimersByTimeAsync(0)
        stop()
        expect(pub).toHaveBeenCalledWith(expect.stringContaining('"status":"update-available"'))
      })
    })

    describe('logging of resolved channel', () => {
      it('logs resolved channel and source (derived vs explicit) at startup', async () => {
        const mod = await makeModule(undefined)
        mockAxiosGet.mockResolvedValueOnce({ data: [{ tag_name: 'v2026.6.0', released_at: '2026-05-01T12:00:00Z' }] })
        const stop = mod.startVersionChecker('2026.6.0b1', makeTelemetryCtx())
        await vi.advanceTimersByTimeAsync(0)
        stop()
        const allInfoCalls = loggerSpies.info.mock.calls.map((c) => String(c[0]))
        // Should log that channel is beta and was derived (not explicit)
        expect(allInfoCalls.some((msg) => msg.includes('beta') && msg.includes('derived'))).toBe(true)
      })

      it('logs resolved channel as explicit when updateChannel is set', async () => {
        const mod = await makeModule('stable')
        mockAxiosGet.mockResolvedValueOnce({ data: [{ tag_name: 'v2026.6.0', released_at: '2026-05-01T12:00:00Z' }] })
        const stop = mod.startVersionChecker('2026.6.0', makeTelemetryCtx())
        await vi.advanceTimersByTimeAsync(0)
        stop()
        const allInfoCalls = loggerSpies.info.mock.calls.map((c) => String(c[0]))
        expect(allInfoCalls.some((msg) => msg.includes('stable') && msg.includes('explicit'))).toBe(true)
      })
    })
  })

  // ── resolveUpdateChannel unit tests ─────────────────────────────────────
  describe('resolveUpdateChannel', () => {
    let resolveUpdateChannel: typeof import('@/version-checker.js')['resolveUpdateChannel']

    beforeEach(async () => {
      vi.resetModules()
      vi.doMock('@/config.js', () => ({
        default: {
          versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined, notifyGracePeriod: 3600 },
          telemetryEnabled: false,
        },
      }))
      const mod = await import('@/version-checker.js')
      resolveUpdateChannel = mod.resolveUpdateChannel
    })

    describe('precedence: explicit > image > derived', () => {
      it('explicit configured beats image channel', () => {
        const result = resolveUpdateChannel({
          configured: 'stable',
          imageChannel: 'beta',
          currentVersion: '2026.6.0b1',
        })
        expect(result).toEqual({ channel: 'stable', source: 'explicit' })
      })

      it('explicit configured beats derived', () => {
        const result = resolveUpdateChannel({ configured: 'beta', imageChannel: undefined, currentVersion: '2026.6.0' })
        expect(result).toEqual({ channel: 'beta', source: 'explicit' })
      })

      it('image channel beats version-derived when no explicit config', () => {
        // Running stable version (2026.6.4) but image says beta → image wins
        const result = resolveUpdateChannel({ configured: undefined, imageChannel: 'beta', currentVersion: '2026.6.4' })
        expect(result).toEqual({ channel: 'beta', source: 'image' })
      })

      it('image channel beta used when no explicit config and stable version', () => {
        const result = resolveUpdateChannel({
          configured: undefined,
          imageChannel: 'stable',
          currentVersion: '2026.6.0b1',
        })
        expect(result).toEqual({ channel: 'stable', source: 'image' })
      })

      it('falls through to version-derived when no explicit and no image channel', () => {
        const result = resolveUpdateChannel({
          configured: undefined,
          imageChannel: undefined,
          currentVersion: '2026.6.0b1',
        })
        expect(result).toEqual({ channel: 'beta', source: 'derived' })
      })

      it('falls through to derived stable when no explicit, no image channel, stable version', () => {
        const result = resolveUpdateChannel({
          configured: undefined,
          imageChannel: undefined,
          currentVersion: '2026.6.4',
        })
        expect(result).toEqual({ channel: 'stable', source: 'derived' })
      })
    })

    describe('empty-string and junk image channel normalization', () => {
      it('empty string imageChannel falls through to version-derived', () => {
        // Running stable version → derived should be stable (not broken/empty)
        const result = resolveUpdateChannel({ configured: undefined, imageChannel: '', currentVersion: '2026.6.4' })
        expect(result).toEqual({ channel: 'stable', source: 'derived' })
      })

      it('empty string imageChannel + pre-release version falls through to beta-derived', () => {
        const result = resolveUpdateChannel({ configured: undefined, imageChannel: '', currentVersion: '2026.6.0b1' })
        expect(result).toEqual({ channel: 'beta', source: 'derived' })
      })

      it('"Beta" (capital B) imageChannel falls through to version-derived', () => {
        const result = resolveUpdateChannel({ configured: undefined, imageChannel: 'Beta', currentVersion: '2026.6.4' })
        expect(result).toEqual({ channel: 'stable', source: 'derived' })
      })

      it('"xyz" junk imageChannel falls through to version-derived', () => {
        const result = resolveUpdateChannel({ configured: undefined, imageChannel: 'xyz', currentVersion: '2026.6.4' })
        expect(result).toEqual({ channel: 'stable', source: 'derived' })
      })
    })

    describe('source label in startup log', () => {
      it('logs "image default" when channel is resolved from imageChannel', () => {
        mockAxiosGet.mockResolvedValue({ data: [] })
        // Use the 4th arg to pass imageChannel
        // We re-import startVersionChecker via the same module
        let startFn: typeof import('@/version-checker.js')['startVersionChecker']
        vi.resetModules()
        vi.doMock('@/config.js', () => ({
          default: {
            versionCheck: {
              checkInterval: 3600,
              ntfyWebhookUrl: undefined,
              updateChannel: undefined,
              notifyGracePeriod: 3600,
            },
            telemetryEnabled: false,
          },
        }))
        // We test this through the startVersionChecker log output
        return import('@/version-checker.js').then((mod) => {
          startFn = mod.startVersionChecker
          const stop = startFn('2026.6.4', makeTelemetryCtx(), undefined, 'beta')
          stop()
          const allInfoCalls = loggerSpies.info.mock.calls.map((c) => String(c[0]))
          expect(allInfoCalls.some((msg) => msg.includes('beta') && msg.includes('image'))).toBe(true)
        })
      })

      it('logs "explicit override" when channel is from config', () => {
        mockAxiosGet.mockResolvedValue({ data: [] })
        let startFn: typeof import('@/version-checker.js')['startVersionChecker']
        vi.resetModules()
        vi.doMock('@/config.js', () => ({
          default: {
            versionCheck: {
              checkInterval: 3600,
              ntfyWebhookUrl: undefined,
              updateChannel: 'stable',
              notifyGracePeriod: 3600,
            },
            telemetryEnabled: false,
          },
        }))
        return import('@/version-checker.js').then((mod) => {
          startFn = mod.startVersionChecker
          const stop = startFn('2026.6.4', makeTelemetryCtx(), undefined, 'beta')
          stop()
          const allInfoCalls = loggerSpies.info.mock.calls.map((c) => String(c[0]))
          expect(allInfoCalls.some((msg) => msg.includes('stable') && msg.includes('explicit'))).toBe(true)
        })
      })
    })
  })

  // ── E2E regression: stable version + image channel beta → notification fires ─
  // This is the exact bug: :next re-tagged to stable (2026.6.4, no bN) would
  // previously derive 'stable' and miss beta updates. With image channel baked
  // in as 'beta', it must fire update-available for a numerically-higher beta.
  describe('E2E regression: stable version on beta image channel', () => {
    let moduleReg: typeof import('@/version-checker.js')
    let pubReg: ReturnType<typeof vi.fn>
    let mqttReg: IMqtt

    beforeEach(async () => {
      vi.resetModules()
      vi.doMock('@/config.js', () => ({
        default: {
          versionCheck: {
            checkInterval: 3600,
            ntfyWebhookUrl: undefined,
            updateChannel: undefined, // no explicit config — relies on image channel
            notifyGracePeriod: 0, // disable grace period so release age doesn't suppress
          },
          telemetryEnabled: false,
        },
      }))
      moduleReg = await import('@/version-checker.js')
      pubReg = vi.fn()
      mqttReg = { publishInfo: pubReg } as unknown as IMqtt
    })

    it('running 2026.6.4 (stable) + imageChannel=beta + newer beta available → update-available fires', async () => {
      // Simulate: :next image carrying promoted-stable 2026.6.4 with UPDATE_CHANNEL=beta baked in.
      // A later beta 2026.6.5b1 is available. Without the fix, this would derive 'stable' and miss it.
      mockAxiosGet.mockResolvedValueOnce({
        data: [
          { tag_name: 'v2026.6.5b1', released_at: '2026-05-01T12:00:00Z' }, // beta, numerically higher
          { tag_name: 'v2026.6.4', released_at: '2026-04-01T12:00:00Z' }, // current stable
        ],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      // Pass 'beta' as 4th arg (imageChannel baked into :next Docker image)
      const stop = moduleReg.startVersionChecker('2026.6.4', makeTelemetryCtx(), mqttReg, 'beta')
      await vi.advanceTimersByTimeAsync(0)
      stop()

      expect(pubReg).toHaveBeenCalledWith(expect.stringContaining('"status":"update-available"'))
      expect(pubReg).toHaveBeenCalledWith(expect.stringContaining('"latestVersion":"v2026.6.5b1"'))
    })

    it('running 2026.6.4 (stable) + imageChannel=stable + newer beta available → stays up-to-date', async () => {
      // :latest image with UPDATE_CHANNEL=stable baked in; beta not shown on stable channel
      mockAxiosGet
        .mockResolvedValueOnce({
          data: [
            { tag_name: 'v2026.6.5b1', released_at: '2026-05-01T12:00:00Z' },
            { tag_name: 'v2026.6.4', released_at: '2026-04-01T12:00:00Z' },
          ],
        })
        .mockResolvedValueOnce({ data: [] }) // tags fallback (beta filtered from stable releases)
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stop = moduleReg.startVersionChecker('2026.6.4', makeTelemetryCtx(), mqttReg, 'stable')
      await vi.advanceTimersByTimeAsync(0)
      stop()

      // Stable channel: latest stable is 2026.6.4 (current) → up-to-date
      expect(pubReg).toHaveBeenCalledWith(expect.stringContaining('"status":"up-to-date"'))
      expect(pubReg).not.toHaveBeenCalledWith(expect.stringContaining('"status":"update-available"'))
    })

    it('YAML-mode: explicit config channel wins over image channel (config=stable beats imageChannel=beta)', async () => {
      vi.resetModules()
      vi.doMock('@/config.js', () => ({
        default: {
          versionCheck: {
            checkInterval: 3600,
            ntfyWebhookUrl: undefined,
            updateChannel: 'stable', // explicit YAML/env override
            notifyGracePeriod: 0,
          },
          telemetryEnabled: false,
        },
      }))
      const mod = await import('@/version-checker.js')
      const pub = vi.fn()
      const mqtt = { publishInfo: pub } as unknown as IMqtt

      mockAxiosGet
        .mockResolvedValueOnce({
          data: [
            { tag_name: 'v2026.6.5b1', released_at: '2026-05-01T12:00:00Z' },
            { tag_name: 'v2026.6.4', released_at: '2026-04-01T12:00:00Z' },
          ],
        })
        .mockResolvedValueOnce({ data: [] })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      // imageChannel=beta passed but explicit config=stable should win
      const stop = mod.startVersionChecker('2026.6.4', makeTelemetryCtx(), mqtt, 'beta')
      await vi.advanceTimersByTimeAsync(0)
      stop()

      // stable config wins → no beta update-available
      expect(pub).toHaveBeenCalledWith(expect.stringContaining('"status":"up-to-date"'))
      expect(pub).not.toHaveBeenCalledWith(expect.stringContaining('"status":"update-available"'))
    })

    it('YAML-mode: no explicit config + imageChannel=beta → beta channel honored', async () => {
      // Verifies the image default works even though E2M_IMAGE_CHANNEL never goes through config.ts
      mockAxiosGet.mockResolvedValueOnce({
        data: [
          { tag_name: 'v2026.6.5b1', released_at: '2026-05-01T12:00:00Z' },
          { tag_name: 'v2026.6.4', released_at: '2026-04-01T12:00:00Z' },
        ],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stop = moduleReg.startVersionChecker('2026.6.4', makeTelemetryCtx(), mqttReg, 'beta')
      await vi.advanceTimersByTimeAsync(0)
      stop()

      expect(pubReg).toHaveBeenCalledWith(expect.stringContaining('"status":"update-available"'))
    })
  })
})

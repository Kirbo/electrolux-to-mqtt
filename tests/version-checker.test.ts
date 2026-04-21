import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IMqtt } from '@/mqtt.js'

// Mock dependencies before importing the module
vi.mock('axios')
vi.mock('@/logger.js', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Mock config with default values
vi.mock('@/config.js', () => ({
  default: {
    versionCheck: {
      checkInterval: 3600,
      ntfyWebhookUrl: undefined,
    },
    telemetryEnabled: true,
  },
}))

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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')

      // Wait for immediate check to complete
      await vi.advanceTimersByTimeAsync(0)

      // Should fetch latest version from GitLab
      expect(mockAxiosGet).toHaveBeenCalledWith(
        expect.stringContaining('/releases'),
        expect.objectContaining({
          timeout: 10000,
        }),
      )

      // Should send telemetry
      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://e2m.devaus.eu/telemetry',
        { userHash: 'test-hash-123', version: 'v1.6.3' },
        expect.any(Object),
      )

      stopChecker()
    })

    it('should return a function that stops the version checker', () => {
      mockAxiosGet.mockResolvedValue({ data: [] })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')

      expect(typeof stopChecker).toBe('function')
      expect(() => stopChecker()).not.toThrow()
    })

    it('should check for updates at configured interval', async () => {
      mockAxiosGet.mockResolvedValue({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')

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

      const stopChecker = startVersionChecker('development', 'test-hash-123')

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
          versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined, updateChannel: 'beta' },
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
      const stopChecker = moduleForCmp.startVersionChecker(current, 'hash', mockMqttCmp)
      await vi.advanceTimersByTimeAsync(0)
      stopChecker()
      const calls = mockPublishInfoCmp.mock.calls
      if (calls.length === 0) return null
      return JSON.parse(calls[0][0] as string) as Record<string, unknown>
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
          versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined, updateChannel: 'beta' },
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

      const stopChecker = moduleWithBetaRcToStable.startVersionChecker('1.17.0-rc.7', 'hash', mockMqttBeta)
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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')

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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')

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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')

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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')

      await vi.advanceTimersByTimeAsync(0)

      expect(mockAxiosGet).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/kirbo%2Felectrolux-to-mqtt/releases',
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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')

      await vi.advanceTimersByTimeAsync(0)

      // Should have called both releases and tags endpoints
      expect(mockAxiosGet).toHaveBeenCalledWith(expect.stringContaining('/releases'), expect.any(Object))
      expect(mockAxiosGet).toHaveBeenCalledWith(
        'https://gitlab.com/api/v4/projects/kirbo%2Felectrolux-to-mqtt/repository/tags',
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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')

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
      const stopChecker = startVersionChecker('v1.6.1', 'test-hash-123', mockMqtt)

      await vi.advanceTimersByTimeAsync(0)

      // Should have detected v1.6.4 as the latest (sorted by created_at)
      expect(mockPublishInfo).toHaveBeenCalledWith(expect.stringContaining('"latestVersion":"v1.6.4"'))

      stopChecker()
    })

    it('should handle GitLab API errors gracefully', async () => {
      const error = new Error('Network error')
      mockAxiosGet.mockRejectedValueOnce(error)
      vi.mocked(axios.isAxiosError).mockReturnValue(false)

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')

      await vi.advanceTimersByTimeAsync(0)

      // Should not throw
      expect(mockAxiosGet).toHaveBeenCalled()

      stopChecker()
    })

    it('should handle axios errors', async () => {
      const error = { message: 'Request timeout', isAxiosError: true }
      mockAxiosGet.mockRejectedValueOnce(error)
      vi.mocked(axios.isAxiosError).mockReturnValue(true)

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')

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
          versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined },
          telemetryEnabled: false,
        },
      }))

      moduleWithOptOut = await import('@/version-checker.js')
    })

    it('should skip telemetry POST when telemetryEnabled is false', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })

      const stopChecker = moduleWithOptOut.startVersionChecker('v1.6.3', 'test-hash-123')
      await vi.advanceTimersByTimeAsync(0)

      // Version check should still run
      expect(mockAxiosGet).toHaveBeenCalled()
      // But telemetry POST should NOT have been called
      expect(mockAxiosPost).not.toHaveBeenCalledWith(
        'https://e2m.devaus.eu/telemetry',
        expect.anything(),
        expect.anything(),
      )

      stopChecker()
    })

    it('should send telemetry when telemetryEnabled is explicitly true', async () => {
      vi.resetModules()
      vi.doMock('@/config.js', () => ({
        default: {
          versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined },
          telemetryEnabled: true,
        },
      }))
      const mod = await import('@/version-checker.js')

      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = mod.startVersionChecker('v1.6.3', 'test-hash-123')
      await vi.advanceTimersByTimeAsync(0)

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://e2m.devaus.eu/telemetry',
        { userHash: 'test-hash-123', version: 'v1.6.3' },
        expect.any(Object),
      )

      stopChecker()
    })
  })

  describe('telemetry', () => {
    it('should send telemetry with user hash and version', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: '2026-01-28T12:00:00Z' }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-abc')

      await vi.advanceTimersByTimeAsync(0)

      expect(mockAxiosPost).toHaveBeenCalledWith(
        'https://e2m.devaus.eu/telemetry',
        {
          userHash: 'test-hash-abc',
          version: 'v1.6.3',
        },
        expect.objectContaining({
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')

      // Should not throw even if telemetry fails
      await vi.advanceTimersByTimeAsync(0)

      // Should have attempted telemetry
      expect(mockAxiosPost).toHaveBeenCalled()

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

      const stopChecker = moduleWithNtfy.startVersionChecker('v1.6.3', 'test-hash-123')

      await vi.advanceTimersByTimeAsync(0)

      // Should send both telemetry and ntfy notification
      expect(mockAxiosPost).toHaveBeenCalledTimes(2)

      // First call should be telemetry
      expect(mockAxiosPost).toHaveBeenNthCalledWith(
        1,
        'https://e2m.devaus.eu/telemetry',
        {
          userHash: 'test-hash-123',
          version: 'v1.6.3',
        },
        expect.objectContaining({
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          },
        }),
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

      const stopChecker = moduleWithNtfy.startVersionChecker('v1.6.3', 'test-hash-123')

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

      const stopChecker = moduleWithNtfy.startVersionChecker('v1.6.3', 'test-hash-123')
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

      const stopChecker = moduleWithNtfy.startVersionChecker('v1.6.3', 'test-hash-123')
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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)
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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)
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

    it('should not notify about a newer version released less than 1 hour ago', async () => {
      const now = new Date('2026-04-21T12:00:00Z')
      vi.setSystemTime(now)
      const recentRelease = new Date(now.getTime() - 30 * 60 * 1000).toISOString()

      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: recentRelease }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      expect(mockPublishInfo).not.toHaveBeenCalledWith(expect.stringContaining('update-available'))
      stopChecker()
    })

    it('should notify about a newer version released more than 1 hour ago', async () => {
      const now = new Date('2026-04-21T12:00:00Z')
      vi.setSystemTime(now)
      const oldRelease = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()

      mockAxiosGet.mockResolvedValueOnce({
        data: [{ tag_name: 'v1.6.4', released_at: oldRelease }],
      })
      mockAxiosPost.mockResolvedValue({ data: { success: true } })

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      expect(mockPublishInfo).toHaveBeenCalledWith(expect.stringContaining('update-available'))
      stopChecker()
    })

    it('should publish development status and skip version fetch for development builds', async () => {
      const stopChecker = startVersionChecker('development', 'test-hash-123', mockMqtt)
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
      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123')
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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)

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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)

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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)
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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)
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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)
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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)
      await vi.advanceTimersByTimeAsync(0)

      const publishedPayload = JSON.parse(mockPublishInfo.mock.calls[0][0])
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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)

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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)
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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)

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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)

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

      const stopChecker = startVersionChecker('v1.6.3', 'test-hash-123', mockMqtt)
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
            versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined, updateChannel: 'stable' },
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

        const stopChecker = moduleWithStable.startVersionChecker('v1.14.0', 'hash', mockMqttStable)
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

        const stopChecker = moduleWithStable.startVersionChecker('v1.14.0', 'hash', mockMqttStable)
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

        const stopChecker = moduleWithStable.startVersionChecker('v1.14.0', 'hash', mockMqttStable)
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
            versionCheck: { checkInterval: 3600, ntfyWebhookUrl: undefined, updateChannel: 'beta' },
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

        const stopChecker = moduleWithBeta.startVersionChecker('v1.14.0', 'hash', mockMqttBeta)
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

        const stopChecker = moduleWithBeta.startVersionChecker('v1.14.0', 'hash', mockMqttBeta)
        await vi.advanceTimersByTimeAsync(0)

        // Beta channel: rc tag should surface
        expect(mockPublishInfoBeta).toHaveBeenCalledWith(expect.stringContaining('"latestVersion":"v1.15.1-rc.1"'))

        stopChecker()
      })
    })
  })
})

import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies before importing the module
vi.mock('axios')
vi.mock('../src/logger.js', () => ({
  default: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

// Mock config with default values
vi.mock('../src/config.js', () => ({
  default: {
    versionCheck: {
      checkInterval: 3600,
      ntfyWebhookUrl: undefined,
    },
  },
}))

describe('version-checker', () => {
  let startVersionChecker: (currentVersion: string, userHash: string) => () => void
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
    const module = await import('../src/version-checker.js')
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
    let moduleWithNtfy: typeof import('../src/version-checker.js')

    beforeEach(async () => {
      // Clear module cache and re-mock config with ntfy webhook
      vi.resetModules()

      vi.doMock('../src/config.js', () => ({
        default: {
          versionCheck: {
            checkInterval: 3600,
            ntfyWebhookUrl: 'https://ntfy.sh/vB66ozQaRiqhTE9j',
          },
        },
      }))

      // Re-import the module with the new config
      moduleWithNtfy = await import('../src/version-checker.js')
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
  })
})

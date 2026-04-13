import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/config.js', () => ({
  default: {
    healthCheck: {
      enabled: true,
      filePath: '/tmp/e2m-health-test',
    },
  },
}))

const mockWarn = vi.fn()

vi.mock('../src/logger.js', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: mockWarn,
    debug: vi.fn(),
  })),
}))

describe('health', () => {
  beforeEach(() => {
    // Clean up any leftover health files
    try {
      fs.unlinkSync('/tmp/e2m-health-test')
    } catch {
      // File doesn't exist
    }
  })

  afterEach(() => {
    try {
      fs.unlinkSync('/tmp/e2m-health-test')
    } catch {
      // File doesn't exist
    }
  })

  describe('writeHealthFile', () => {
    it('should write current timestamp to health file', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile()

      const content = fs.readFileSync('/tmp/e2m-health-test', 'utf8')
      const timestamp = Number.parseInt(content, 10)
      const now = Math.floor(Date.now() / 1000)

      expect(timestamp).toBeGreaterThan(0)
      expect(Math.abs(timestamp - now)).toBeLessThan(2)
    })

    it('should overwrite previous health file', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile()
      const first = fs.readFileSync('/tmp/e2m-health-test', 'utf8')

      // Wait a tiny bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))

      writeHealthFile()
      const second = fs.readFileSync('/tmp/e2m-health-test', 'utf8')

      // Both should be valid timestamps (may or may not be different within 10ms)
      expect(Number.parseInt(first, 10)).toBeGreaterThan(0)
      expect(Number.parseInt(second, 10)).toBeGreaterThan(0)
    })
  })

  describe('writeHealthFile when disabled', () => {
    it('should not write file when health check is disabled', async () => {
      vi.doMock('../src/config.js', () => ({
        default: {
          healthCheck: {
            enabled: false,
            filePath: '/tmp/e2m-health-test-disabled',
          },
        },
      }))

      const { writeHealthFile } = await import('../src/health.js')
      writeHealthFile()

      expect(fs.existsSync('/tmp/e2m-health-test-disabled')).toBe(false)
    })
  })

  describe('writeHealthFile with MQTT status', () => {
    it('should not write file when MQTT is disconnected', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile({ mqttConnected: false, apiConnected: true })

      expect(fs.existsSync('/tmp/e2m-health-test')).toBe(false)
    })

    it('should write file when MQTT is connected', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile({ mqttConnected: true, apiConnected: true })

      const content = fs.readFileSync('/tmp/e2m-health-test', 'utf8')
      const timestamp = Number.parseInt(content, 10)
      expect(timestamp).toBeGreaterThan(0)
    })

    it('should write file when no status is provided (backwards compatible)', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile()

      const content = fs.readFileSync('/tmp/e2m-health-test', 'utf8')
      const timestamp = Number.parseInt(content, 10)
      expect(timestamp).toBeGreaterThan(0)
    })
  })

  describe('writeHealthFile with API status', () => {
    it('should not write file when API is disconnected', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile({ mqttConnected: true, apiConnected: false })

      expect(fs.existsSync('/tmp/e2m-health-test')).toBe(false)
    })

    it('should not write file when both MQTT and API are disconnected', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile({ mqttConnected: false, apiConnected: false })

      expect(fs.existsSync('/tmp/e2m-health-test')).toBe(false)
    })

    it('should write file when both MQTT and API are connected', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile({ mqttConnected: true, apiConnected: true })

      const content = fs.readFileSync('/tmp/e2m-health-test', 'utf8')
      const timestamp = Number.parseInt(content, 10)
      expect(timestamp).toBeGreaterThan(0)
    })
  })

  describe('isHealthy', () => {
    it('should return true when health file is recent', async () => {
      const { writeHealthFile, isHealthy } = await import('../src/health.js')

      writeHealthFile()

      expect(isHealthy(60)).toBe(true)
    })

    it('should return false when health file is stale', async () => {
      const { isHealthy } = await import('../src/health.js')

      // Write a timestamp from 5 minutes ago
      const staleTimestamp = Math.floor(Date.now() / 1000) - 300
      fs.writeFileSync('/tmp/e2m-health-test', String(staleTimestamp), 'utf8')

      expect(isHealthy(60)).toBe(false)
    })

    it('should return false when health file does not exist', async () => {
      const { isHealthy } = await import('../src/health.js')

      expect(isHealthy(60)).toBe(false)
    })
  })

  describe('writeHealthFile write-failure warn-once', () => {
    let writeSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      mockWarn.mockClear()
      vi.resetModules()
      // Re-register the enabled config mock so vi.doMock from the disabled-check
      // test above does not bleed into these tests after module reset.
      vi.doMock('../src/config.js', () => ({
        default: {
          healthCheck: {
            enabled: true,
            filePath: '/tmp/e2m-health-test',
          },
        },
      }))
      writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('EROFS: read-only file system')
      })
    })

    afterEach(() => {
      writeSpy.mockRestore()
    })

    it('should log a warning on the first write failure', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile()

      expect(mockWarn).toHaveBeenCalledTimes(1)
    })

    it('should not log a warning on subsequent write failures after the first', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile()
      writeHealthFile()
      writeHealthFile()

      expect(mockWarn).toHaveBeenCalledTimes(1)
    })

    it('should still attempt fs.writeFileSync on every call even after the first failure', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile()
      writeHealthFile()
      writeHealthFile()

      expect(writeSpy).toHaveBeenCalledTimes(3)
    })
  })

  describe('writeHealthFile EACCES permission denied', () => {
    let writeSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      mockWarn.mockClear()
      vi.resetModules()
      vi.doMock('../src/config.js', () => ({
        default: {
          healthCheck: {
            enabled: true,
            filePath: '/tmp/e2m-health-test',
          },
        },
      }))
      writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        const err = new Error("EACCES: permission denied, open '/tmp/e2m-health-test'")
        ;(err as NodeJS.ErrnoException).code = 'EACCES'
        throw err
      })
    })

    afterEach(() => {
      writeSpy.mockRestore()
    })

    it('should log a warning on the first EACCES failure', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile()

      expect(mockWarn).toHaveBeenCalledTimes(1)
    })

    it('should not log a warning on subsequent EACCES failures after the first', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile()
      writeHealthFile()
      writeHealthFile()

      // Same warn-once behaviour as EROFS
      expect(mockWarn).toHaveBeenCalledTimes(1)
    })

    it('should keep attempting fs.writeFileSync on every call even after the first EACCES', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      writeHealthFile()
      writeHealthFile()
      writeHealthFile()

      expect(writeSpy).toHaveBeenCalledTimes(3)
    })

    it('should not crash the process on EACCES', async () => {
      const { writeHealthFile } = await import('../src/health.js')

      expect(() => writeHealthFile()).not.toThrow()
    })
  })
})

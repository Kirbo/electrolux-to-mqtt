import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HEALTH_FILE = path.join(os.tmpdir(), `e2m-health-test-${process.pid}`)

vi.mock('@/config.js', () => ({
  default: {
    healthCheck: {
      enabled: true,
      filePath: HEALTH_FILE,
    },
  },
}))

const mockWarn = vi.fn()

vi.mock('@/logger.js', () => ({
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
      fs.unlinkSync(HEALTH_FILE)
    } catch {
      // File doesn't exist
    }
  })

  afterEach(() => {
    try {
      fs.unlinkSync(HEALTH_FILE)
    } catch {
      // File doesn't exist
    }
  })

  describe('writeHealthFile', () => {
    it('should write current timestamp to health file', async () => {
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile()

      const content = fs.readFileSync(HEALTH_FILE, 'utf8')
      const timestamp = Number.parseInt(content, 10)
      const now = Math.floor(Date.now() / 1000)

      expect(timestamp).toBeGreaterThan(0)
      expect(Math.abs(timestamp - now)).toBeLessThan(2)
    })

    it('should overwrite previous health file', async () => {
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile()
      const first = fs.readFileSync(HEALTH_FILE, 'utf8')

      // Wait a tiny bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))

      writeHealthFile()
      const second = fs.readFileSync(HEALTH_FILE, 'utf8')

      // Both should be valid timestamps (may or may not be different within 10ms)
      expect(Number.parseInt(first, 10)).toBeGreaterThan(0)
      expect(Number.parseInt(second, 10)).toBeGreaterThan(0)
    })
  })

  describe('writeHealthFile when disabled', () => {
    afterEach(() => {
      vi.resetModules()
      vi.doMock('@/config.js', () => ({
        default: {
          healthCheck: {
            enabled: true,
            filePath: HEALTH_FILE,
          },
        },
      }))
    })

    it('should not write file when health check is disabled', async () => {
      vi.resetModules()
      vi.doMock('@/config.js', () => ({
        default: {
          healthCheck: {
            enabled: false,
            filePath: HEALTH_FILE,
          },
        },
      }))

      const { writeHealthFile } = await import('@/health.js')
      writeHealthFile()

      expect(fs.existsSync(HEALTH_FILE)).toBe(false)
    })
  })

  describe('writeHealthFile with MQTT status', () => {
    it('should not write file when MQTT is disconnected', async () => {
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile({ mqttConnected: false, apiConnected: true })

      expect(fs.existsSync(HEALTH_FILE)).toBe(false)
    })

    it('should write file when MQTT is connected', async () => {
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile({ mqttConnected: true, apiConnected: true })

      const content = fs.readFileSync(HEALTH_FILE, 'utf8')
      const timestamp = Number.parseInt(content, 10)
      expect(timestamp).toBeGreaterThan(0)
    })

    it('should write file when no status is provided (backwards compatible)', async () => {
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile()

      const content = fs.readFileSync(HEALTH_FILE, 'utf8')
      const timestamp = Number.parseInt(content, 10)
      expect(timestamp).toBeGreaterThan(0)
    })
  })

  describe('writeHealthFile with API status', () => {
    it('should not write file when API is disconnected', async () => {
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile({ mqttConnected: true, apiConnected: false })

      expect(fs.existsSync(HEALTH_FILE)).toBe(false)
    })

    it('should not write file when both MQTT and API are disconnected', async () => {
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile({ mqttConnected: false, apiConnected: false })

      expect(fs.existsSync(HEALTH_FILE)).toBe(false)
    })

    it('should write file when both MQTT and API are connected', async () => {
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile({ mqttConnected: true, apiConnected: true })

      const content = fs.readFileSync(HEALTH_FILE, 'utf8')
      const timestamp = Number.parseInt(content, 10)
      expect(timestamp).toBeGreaterThan(0)
    })
  })

  describe('isHealthy', () => {
    it('should return true when health file is recent', async () => {
      const { writeHealthFile, isHealthy } = await import('@/health.js')

      writeHealthFile()

      expect(isHealthy(60)).toBe(true)
    })

    it('should return false when health file is stale', async () => {
      const { isHealthy } = await import('@/health.js')

      // Write a timestamp from 5 minutes ago
      const staleTimestamp = Math.floor(Date.now() / 1000) - 300
      fs.writeFileSync(HEALTH_FILE, String(staleTimestamp), 'utf8')

      expect(isHealthy(60)).toBe(false)
    })

    it('should return false when health file does not exist', async () => {
      const { isHealthy } = await import('@/health.js')

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
      vi.doMock('@/config.js', () => ({
        default: {
          healthCheck: {
            enabled: true,
            filePath: HEALTH_FILE,
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
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile()

      expect(mockWarn).toHaveBeenCalledTimes(1)
    })

    it('should not log a warning on subsequent write failures after the first', async () => {
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile()
      writeHealthFile()
      writeHealthFile()

      expect(mockWarn).toHaveBeenCalledTimes(1)
    })

    it('should still attempt fs.writeFileSync on every call even after the first failure', async () => {
      const { writeHealthFile } = await import('@/health.js')

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
      vi.doMock('@/config.js', () => ({
        default: {
          healthCheck: {
            enabled: true,
            filePath: HEALTH_FILE,
          },
        },
      }))
      writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        const err = new Error('EACCES: permission denied, open HEALTH_FILE')
        ;(err as NodeJS.ErrnoException).code = 'EACCES'
        throw err
      })
    })

    afterEach(() => {
      writeSpy.mockRestore()
    })

    it('should log a warning on the first EACCES failure', async () => {
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile()

      expect(mockWarn).toHaveBeenCalledTimes(1)
    })

    it('should not log a warning on subsequent EACCES failures after the first', async () => {
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile()
      writeHealthFile()
      writeHealthFile()

      // Same warn-once behaviour as EROFS
      expect(mockWarn).toHaveBeenCalledTimes(1)
    })

    it('should keep attempting fs.writeFileSync on every call even after the first EACCES', async () => {
      const { writeHealthFile } = await import('@/health.js')

      writeHealthFile()
      writeHealthFile()
      writeHealthFile()

      expect(writeSpy).toHaveBeenCalledTimes(3)
    })

    it('should not crash the process on EACCES', async () => {
      const { writeHealthFile } = await import('@/health.js')

      expect(() => writeHealthFile()).not.toThrow()
    })
  })
})

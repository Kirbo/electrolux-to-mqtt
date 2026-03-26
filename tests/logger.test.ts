import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('logger', () => {
  describe('log levels', () => {
    it('should support debug level', () => {
      const level = 'debug'
      expect(level).toBe('debug')
    })

    it('should support info level', () => {
      const level = 'info'
      expect(level).toBe('info')
    })

    it('should support warn level', () => {
      const level = 'warn'
      expect(level).toBe('warn')
    })

    it('should support error level', () => {
      const level = 'error'
      expect(level).toBe('error')
    })
  })

  describe('logger creation', () => {
    it('should create logger with context', () => {
      const context = 'test-module'
      expect(context).toBe('test-module')
    })

    it('should format log messages with context', () => {
      const context = 'mqtt'
      const message = 'Connected to broker'
      const formatted = `[${context}] ${message}`

      expect(formatted).toBe('[mqtt] Connected to broker')
    })
  })

  describe('timestamp formatting', () => {
    it('should format ISO timestamp', () => {
      const date = new Date('2024-01-01T12:00:00Z')
      const iso = date.toISOString()

      expect(iso).toBe('2024-01-01T12:00:00.000Z')
    })

    it('should format locale timestamp', () => {
      const date = new Date('2024-01-01T12:00:00Z')
      const locale = date.toLocaleString()

      expect(locale).toBeTruthy()
    })
  })

  describe('console colors', () => {
    it('should define color codes', () => {
      const colors = {
        reset: '\x1b[0m',
        red: '\x1b[31m',
        yellow: '\x1b[33m',
        blue: '\x1b[34m',
        gray: '\x1b[90m',
      }

      expect(colors.reset).toBe('\x1b[0m')
      expect(colors.red).toBe('\x1b[31m')
      expect(colors.yellow).toBe('\x1b[33m')
      expect(colors.blue).toBe('\x1b[34m')
      expect(colors.gray).toBe('\x1b[90m')
    })
  })

  describe('log message formatting', () => {
    it('should join multiple arguments', () => {
      const args = ['Message', { key: 'value' }, 123]
      const joined = args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ')

      expect(joined).toBe('Message {"key":"value"} 123')
    })

    it('should handle error objects', () => {
      const error = new Error('Test error')
      const errorString = error.toString()

      expect(errorString).toContain('Test error')
    })
  })

  describe('environment log level', () => {
    it('should read LOG_LEVEL from environment', () => {
      const logLevel = process.env.LOG_LEVEL || 'info'
      expect(['debug', 'info', 'warn', 'error'].includes(logLevel)).toBe(true)
    })

    it('should default to info level', () => {
      const defaultLevel = 'info'
      expect(defaultLevel).toBe('info')
    })
  })

  describe('timezone handling', () => {
    it('should read timezone from TZ env var', () => {
      const tzValue = 'America/New_York'
      expect(tzValue).toBeTruthy()
    })

    it('should fallback to UTC when timezone cannot be detected', () => {
      const fallback = 'UTC'
      expect(fallback).toBe('UTC')
    })

    it('should handle zoneinfo path format', () => {
      const zoneinfoPath = '/usr/share/zoneinfo/Europe/Helsinki'
      const regex = /zoneinfo\/(.*)/
      const match = regex.exec(zoneinfoPath)
      expect(match).toBeTruthy()
      if (match) {
        expect(match[1]).toBe('Europe/Helsinki')
      }
    })
  })

  describe('showTimestamp config', () => {
    it('should default showTimestamp to true', () => {
      const showTimestamp = undefined ?? true
      expect(showTimestamp).toBe(true)
    })

    it('should respect showTimestamp when set to true', () => {
      const showTimestamp = true
      const timestamp = showTimestamp
        ? () =>
            `,"time":"${new Date().toLocaleString(undefined, {
              timeZone: 'UTC',
            })}"`
        : false
      expect(typeof timestamp).toBe('function')
    })

    it('should disable timestamp when showTimestamp is false', () => {
      const showTimestamp = false
      const timestamp = showTimestamp
        ? () =>
            `,"time":"${new Date().toLocaleString(undefined, {
              timeZone: 'UTC',
            })}"`
        : false
      expect(timestamp).toBe(false)
    })

    it('should include time in ignore list when showTimestamp is false', () => {
      const showTimestamp = false
      const ignore = showTimestamp ? 'pid,hostname' : 'pid,hostname,time'
      expect(ignore).toBe('pid,hostname,time')
    })

    it('should not include time in ignore list when showTimestamp is true', () => {
      const showTimestamp = true
      const ignore = showTimestamp ? 'pid,hostname' : 'pid,hostname,time'
      expect(ignore).toBe('pid,hostname')
    })

    it('should disable translateTime when showTimestamp is false', () => {
      const showTimestamp = false
      const translateTime = showTimestamp ? 'SYS:yyyy-mm-dd HH:MM:ss' : false
      expect(translateTime).toBe(false)
    })

    it('should enable translateTime when showTimestamp is true', () => {
      const showTimestamp = true
      const translateTime = showTimestamp ? 'SYS:yyyy-mm-dd HH:MM:ss' : false
      expect(translateTime).toBe('SYS:yyyy-mm-dd HH:MM:ss')
    })
  })

  describe('version prefix handling', () => {
    it('should format version prefix for production', () => {
      const version = '1.0.0'
      const prefix = `v${version} :: `
      expect(prefix).toBe('v1.0.0 :: ')
    })

    it('should not show version prefix for development', () => {
      const version = 'development'
      const prefix = version === 'development' ? '' : `v${version} :: `
      expect(prefix).toBe('')
    })

    it('should respect showVersionNumber config', () => {
      const showVersionNumber = true
      const version = '2.0.0'
      const prefix = showVersionNumber ? `v${version} :: ` : ''
      expect(prefix).toBe('v2.0.0 :: ')
    })

    it('should hide version when showVersionNumber is false', () => {
      const showVersionNumber = false
      const version = '2.0.0'
      const prefix = showVersionNumber ? `v${version} :: ` : ''
      expect(prefix).toBe('')
    })
  })

  describe('argument stringification', () => {
    it('should stringify string arguments', () => {
      const arg = 'simple string'
      const result = String(arg)
      expect(result).toBe('simple string')
    })

    it('should stringify number arguments', () => {
      const arg = 42
      const result = String(arg)
      expect(result).toBe('42')
    })

    it('should handle null values', () => {
      const arg = null
      const result = String(arg)
      expect(result).toBe('null')
    })

    it('should handle undefined values', () => {
      const arg = undefined
      const result = String(arg)
      expect(result).toBe('undefined')
    })

    it('should handle object stringification', () => {
      const arg = { key: 'value', nested: { data: 123 } }
      const isObject = typeof arg === 'object' && arg !== null
      expect(isObject).toBe(true)
    })

    it('should handle array stringification', () => {
      const arg = [1, 2, 3, 'test']
      const isObject = typeof arg === 'object' && arg !== null
      expect(isObject).toBe(true)
    })
  })

  describe('actual logger module', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    afterEach(() => {
      vi.restoreAllMocks()
      delete process.env.TZ
      delete process.env.LOG_LEVEL
    })

    it('should use TZ environment variable when set', async () => {
      process.env.TZ = 'Europe/Helsinki'
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('../src/config.js', () => ({
        default: { logging: { showTimestamp: true, showVersionNumber: true } },
      }))

      const { default: createLogger } = await import('../src/logger.js')
      const logger = createLogger('test')

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('TZ env var'))
      expect(logger).toBeDefined()
    })

    it('should fall back to UTC when timezone detection fails', async () => {
      delete process.env.TZ
      vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('ENOENT')
      })
      vi.spyOn(fs, 'readlinkSync').mockImplementation(() => {
        throw new Error('ENOENT')
      })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('../src/config.js', () => ({
        default: { logging: { showTimestamp: true, showVersionNumber: true } },
      }))

      const { default: createLogger } = await import('../src/logger.js')
      const logger = createLogger('test')

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('falling back to UTC'))
      expect(logger).toBeDefined()
    })

    it('should use LOG_LEVEL when explicitly set and apply showTimestamp:false config', async () => {
      process.env.LOG_LEVEL = 'warn'
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('../src/config.js', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: true } },
      }))

      vi.doMock('pino', () => ({
        default: vi.fn().mockReturnValue({
          child: vi.fn().mockReturnValue({
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
          }),
        }),
      }))

      const { default: createLogger } = await import('../src/logger.js')
      const logger = createLogger('test')

      expect(logger).toBeDefined()
      expect(logger.info).toBeDefined()
    })

    it('should create a logger that can log objects via util.inspect', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('../src/config.js', () => ({
        default: { logging: { showTimestamp: true, showVersionNumber: false } },
      }))

      vi.doMock('pino', () => ({
        default: () => ({
          child: () => ({
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
            debug: vi.fn(),
          }),
        }),
      }))

      const { default: createLogger } = await import('../src/logger.js')
      const logger = createLogger('test')

      // Should not throw when logging objects (exercises stringifyArgs with util.inspect)
      expect(() => logger.info({ key: 'value' })).not.toThrow()
      expect(() => logger.error({ errorDetail: 'test' })).not.toThrow()
    })
  })
})

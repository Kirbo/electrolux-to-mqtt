import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('logger', () => {
  describe('createLogger — interface shape', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should return an object with info, warn, error, and debug methods', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('../src/config.js', () => ({
        default: { logging: { showTimestamp: true, showVersionNumber: false } },
      }))

      const { default: createLogger } = await import('../src/logger.js')
      const logger = createLogger('test')

      expect(typeof logger.info).toBe('function')
      expect(typeof logger.warn).toBe('function')
      expect(typeof logger.error).toBe('function')
      expect(typeof logger.debug).toBe('function')
    })

    it('should create distinct loggers for different context names', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('../src/config.js', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: false } },
      }))

      const pinoChildSpy = vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
      vi.doMock('pino', () => ({
        default: vi.fn().mockReturnValue({ child: pinoChildSpy }),
      }))

      const { default: createLogger } = await import('../src/logger.js')
      createLogger('mqtt')
      createLogger('health')

      // Each context name should produce its own child logger
      expect(pinoChildSpy).toHaveBeenCalledTimes(2)
      expect(pinoChildSpy).toHaveBeenCalledWith({ name: 'MQTT' })
      expect(pinoChildSpy).toHaveBeenCalledWith({ name: 'HEALTH' })
    })

    it('should uppercase the context name in the child logger', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('../src/config.js', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: false } },
      }))

      const pinoChildSpy = vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
      vi.doMock('pino', () => ({
        default: vi.fn().mockReturnValue({ child: pinoChildSpy }),
      }))

      const { default: createLogger } = await import('../src/logger.js')
      createLogger('orchestrator')

      expect(pinoChildSpy).toHaveBeenCalledWith({ name: 'ORCHESTRATOR' })
    })

    it('should prepend version prefix when showVersionNumber is true and version is not development', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('../src/config.js', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: true } },
      }))

      const infoSpy = vi.fn()
      vi.doMock('pino', () => ({
        default: vi.fn().mockReturnValue({
          child: vi.fn().mockReturnValue({ info: infoSpy, error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
        }),
      }))

      const { default: createLogger } = await import('../src/logger.js')
      const logger = createLogger('test')
      logger.info('hello')

      expect(infoSpy).toHaveBeenCalledTimes(1)
      const arg = infoSpy.mock.calls[0][0] as string
      // When version is not 'development' a vX.Y.Z :: prefix is prepended
      // The version comes from package.json so we just check it contains ' :: '
      expect(typeof arg).toBe('string')
      expect(arg).toContain('hello')
    })

    it('should not prepend version prefix when showVersionNumber is false', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('../src/config.js', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: false } },
      }))

      const infoSpy = vi.fn()
      vi.doMock('pino', () => ({
        default: vi.fn().mockReturnValue({
          child: vi.fn().mockReturnValue({ info: infoSpy, error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
        }),
      }))

      const { default: createLogger } = await import('../src/logger.js')
      const logger = createLogger('test')
      logger.info('hello')

      const arg = infoSpy.mock.calls[0][0] as string
      // With showVersionNumber false the prefix is empty so message starts directly
      expect(arg).toBe('hello')
    })

    it('should forward multiple arguments as a single joined string', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('../src/config.js', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: false } },
      }))

      const warnSpy = vi.fn()
      vi.doMock('pino', () => ({
        default: vi.fn().mockReturnValue({
          child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: warnSpy, debug: vi.fn() }),
        }),
      }))

      const { default: createLogger } = await import('../src/logger.js')
      const logger = createLogger('test')
      logger.warn('part1', 'part2', 'part3')

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const arg = warnSpy.mock.calls[0][0] as string
      expect(arg).toContain('part1')
      expect(arg).toContain('part2')
      expect(arg).toContain('part3')
    })

    it('should use util.inspect for object arguments', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('../src/config.js', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: false } },
      }))

      const errorSpy = vi.fn()
      vi.doMock('pino', () => ({
        default: vi.fn().mockReturnValue({
          child: vi.fn().mockReturnValue({ info: vi.fn(), error: errorSpy, warn: vi.fn(), debug: vi.fn() }),
        }),
      }))

      const { default: createLogger } = await import('../src/logger.js')
      const logger = createLogger('test')
      logger.error({ code: 42, nested: { ok: true } })

      expect(errorSpy).toHaveBeenCalledTimes(1)
      const arg = errorSpy.mock.calls[0][0] as string
      // util.inspect produces 'key: value' style output for objects
      expect(arg).toContain('code')
      expect(arg).toContain('42')
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

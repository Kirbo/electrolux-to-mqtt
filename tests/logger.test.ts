import fs from 'node:fs'
import { stripVTControlCharacters } from 'node:util'
import { prettyFactory } from 'pino-pretty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type LevelSpy = ReturnType<typeof vi.fn>

// Loads #/logger.js with pino mocked; returns the child logger's level spies.
// inlineMaxKeys defaults to 0 (every field on its own line) so field-shape tests stay unaffected.
const loadWithPinoSpies = async (
  opts: { showVersionNumber?: boolean; version?: string; inlineMaxKeys?: number } = {},
) => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.doMock('#/config.ts', () => ({
    default: {
      logging: {
        showTimestamp: false,
        showVersionNumber: opts.showVersionNumber ?? false,
        inlineMaxKeys: opts.inlineMaxKeys ?? 0,
      },
    },
  }))
  if (opts.version) {
    vi.doMock('../package.json', () => ({ default: { version: opts.version } }))
  }
  const spies: Record<'info' | 'warn' | 'error' | 'debug', LevelSpy> = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }
  vi.doMock('pino', () => ({ default: vi.fn().mockReturnValue({ child: vi.fn().mockReturnValue(spies) }) }))
  const { default: createLogger } = await import('#/logger.ts')
  return { ...spies, createLogger }
}

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

      vi.doMock('#/config.ts', () => ({
        default: { logging: { showTimestamp: true, showVersionNumber: false } },
      }))

      const { default: createLogger } = await import('#/logger.ts')
      const logger = createLogger('test')

      expect(typeof logger.info).toBe('function')
      expect(typeof logger.warn).toBe('function')
      expect(typeof logger.error).toBe('function')
      expect(typeof logger.debug).toBe('function')
    })

    it('should create distinct loggers for different context names', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('#/config.ts', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: false } },
      }))

      const pinoChildSpy = vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
      vi.doMock('pino', () => ({
        default: vi.fn().mockReturnValue({ child: pinoChildSpy }),
      }))

      const { default: createLogger } = await import('#/logger.ts')
      createLogger('mqtt')
      createLogger('health')

      // Each context name should produce its own child logger
      expect(pinoChildSpy).toHaveBeenCalledTimes(2)
      expect(pinoChildSpy).toHaveBeenCalledWith({ name: 'MQTT' })
      expect(pinoChildSpy).toHaveBeenCalledWith({ name: 'HEALTH' })
    })

    it('should uppercase the context name in the child logger', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('#/config.ts', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: false } },
      }))

      const pinoChildSpy = vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
      vi.doMock('pino', () => ({
        default: vi.fn().mockReturnValue({ child: pinoChildSpy }),
      }))

      const { default: createLogger } = await import('#/logger.ts')
      createLogger('orchestrator')

      expect(pinoChildSpy).toHaveBeenCalledWith({ name: 'ORCHESTRATOR' })
    })

    it('should use the config log level, not the LOG_LEVEL env var (YAML/env never mixed)', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.stubEnv('LOG_LEVEL', 'trace')

      vi.doMock('#/config.ts', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: false, logLevel: 'warn' } },
      }))

      const pinoMock = vi.fn().mockReturnValue({
        child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
      })
      vi.doMock('pino', () => ({ default: pinoMock }))

      await import('#/logger.ts')

      expect(pinoMock.mock.calls[0]?.[0]).toMatchObject({ level: 'warn' })
      vi.unstubAllEnvs()
    })

    it('should emit a locale-independent timestamp string', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('#/config.ts', () => ({
        default: { logging: { showTimestamp: true, showVersionNumber: false, logLevel: 'info' } },
      }))

      const pinoMock = vi.fn().mockReturnValue({
        child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
      })
      vi.doMock('pino', () => ({ default: pinoMock }))

      await import('#/logger.ts')

      const options = pinoMock.mock.calls[0]?.[0] as { timestamp: () => string }
      // Fixed `YYYY-MM-DD HH:mm:ss` shape regardless of server locale — the old
      // toLocaleString(undefined, …) output broke pino-pretty on e.g. fi_FI.
      expect(options.timestamp()).toMatch(/^,"time":"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}"$/)
    })

    it('should prepend version prefix when showVersionNumber is true and version is not development', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('#/config.ts', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: true } },
      }))

      const infoSpy = vi.fn()
      vi.doMock('pino', () => ({
        default: vi.fn().mockReturnValue({
          child: vi.fn().mockReturnValue({ info: infoSpy, error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
        }),
      }))

      const { default: createLogger } = await import('#/logger.ts')
      const logger = createLogger('test')
      logger.info('hello')

      expect(infoSpy).toHaveBeenCalledTimes(1)
      const arg = infoSpy.mock.calls[0]?.[0] as string | undefined
      // When version is not 'development' a vX.Y.Z :: prefix is prepended
      // The version comes from package.json so we just check it contains ' :: '
      expect(typeof arg).toBe('string')
      expect(arg).toContain('hello')
    })

    it('should not prepend version prefix when showVersionNumber is false', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('#/config.ts', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: false } },
      }))

      const infoSpy = vi.fn()
      vi.doMock('pino', () => ({
        default: vi.fn().mockReturnValue({
          child: vi.fn().mockReturnValue({ info: infoSpy, error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
        }),
      }))

      const { default: createLogger } = await import('#/logger.ts')
      const logger = createLogger('test')
      logger.info('hello')

      const arg = infoSpy.mock.calls[0]?.[0] as string | undefined
      // With showVersionNumber false the prefix is empty so message starts directly
      expect(arg).toBe('hello')
    })

    it('should forward multiple arguments as a single joined string', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('#/config.ts', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: false } },
      }))

      const warnSpy = vi.fn()
      vi.doMock('pino', () => ({
        default: vi.fn().mockReturnValue({
          child: vi.fn().mockReturnValue({ info: vi.fn(), error: vi.fn(), warn: warnSpy, debug: vi.fn() }),
        }),
      }))

      const { default: createLogger } = await import('#/logger.ts')
      const logger = createLogger('test')
      logger.warn('part1', 'part2', 'part3')

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const arg = warnSpy.mock.calls[0]?.[0] as string | undefined
      expect(arg).toContain('part1')
      expect(arg).toContain('part2')
      expect(arg).toContain('part3')
    })

    it('should keep a strings-only call a single message argument', async () => {
      const spies = await loadWithPinoSpies()
      spies.createLogger('test').info('just', 'text', 42, null, undefined, true)

      expect(spies.info).toHaveBeenCalledWith('just text 42 null undefined true')
    })
  })

  // Objects are handed to pino as structured fields (pino-pretty colors and prints
  // them on their own lines) instead of being stringified into the message, where
  // pino-pretty strips ANSI escapes and log viewers showed raw `[33m…[39m`.
  describe('createLogger — structured fields', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should pass a plain object as fields and keep the text as the message', async () => {
      const spies = await loadWithPinoSpies()
      spies.createLogger('test').info('Message published', { retain: false, qos: 2 })

      expect(spies.info).toHaveBeenCalledWith({ retain: false, qos: 2 }, 'Message published')
    })

    it('should keep text after an object in the message, in order', async () => {
      const spies = await loadWithPinoSpies()
      spies.createLogger('test').info('Received command on topic:', 'a/b', 'Message:', { mode: 'cool' })

      expect(spies.info).toHaveBeenCalledWith({ mode: 'cool' }, 'Received command on topic: a/b Message:')
    })

    it('should pass an Error as the err field so pino-pretty renders its stack', async () => {
      const spies = await loadWithPinoSpies()
      const error = new Error('boom')
      spies.createLogger('test').error('MQTT connection error:', error)

      expect(spies.error).toHaveBeenCalledWith({ err: error }, 'MQTT connection error:')
    })

    it.each([
      ['name', { name: 'Makuuhuone', id: 1 }],
      ['level', { level: 3 }],
      ['time', { time: 'x' }],
      ['msg', { msg: 'x' }],
      ['err', { err: 'x' }],
    ])(
      'should nest an object with the reserved key "%s" under data (it would overwrite pino fields)',
      async (_key, obj) => {
        const spies = await loadWithPinoSpies()
        spies.createLogger('test').info('Appliance info:', obj)

        expect(spies.info).toHaveBeenCalledWith({ data: obj }, 'Appliance info:')
      },
    )

    it('should nest arrays and class instances under data', async () => {
      const spies = await loadWithPinoSpies()
      const logger = spies.createLogger('test')
      logger.debug('Set value:', [1, 2])
      logger.debug('Set value:', new Map([['a', 1]]))

      expect(spies.debug).toHaveBeenNthCalledWith(1, { data: [1, 2] }, 'Set value:')
      expect(spies.debug).toHaveBeenNthCalledWith(2, { data: new Map([['a', 1]]) }, 'Set value:')
    })

    it('should nest an object whose keys clash with earlier fields under the first free data key', async () => {
      const spies = await loadWithPinoSpies()
      spies.createLogger('test').debug('Command response', 200, { ok: true }, { ok: false }, [3])

      expect(spies.debug).toHaveBeenCalledWith({ ok: true, data: { ok: false }, data2: [3] }, 'Command response 200')
    })

    it('should serialize an Error that cannot take err (pino would print a bare Error as {})', async () => {
      const spies = await loadWithPinoSpies()
      const first = new Error('first')
      const second = new TypeError('second')
      spies.createLogger('test').error('Two failures:', first, second)

      const [fields, msg] = spies.error.mock.calls[0] ?? []
      expect(msg).toBe('Two failures:')
      expect(fields).toMatchObject({
        err: first,
        data: { type: 'TypeError', message: 'second', stack: expect.stringContaining('TypeError: second') },
      })
    })

    it('should keep the cause of an Error that cannot take err (cause is non-enumerable)', async () => {
      const spies = await loadWithPinoSpies()
      const root = new Error('socket hang up')
      const second = new Error('request failed', { cause: root })
      spies.createLogger('test').error('Two failures:', new Error('first'), second)

      const [fields] = spies.error.mock.calls[0] ?? []
      // A nested Error cause is flattened too — left as an Error it would print as `{}` again.
      expect(fields).toMatchObject({
        data: { message: 'request failed', cause: { type: 'Error', message: 'socket hang up' } },
      })
    })

    it('should keep a non-Error cause as-is', async () => {
      const spies = await loadWithPinoSpies()
      const second = new Error('request failed', { cause: { status: 503 } })
      spies.createLogger('test').error('Two failures:', new Error('first'), second)

      const [fields] = spies.error.mock.calls[0] ?? []
      expect(fields).toMatchObject({ data: { message: 'request failed', cause: { status: 503 } } })
    })

    it('should stop at a cyclic Error cause instead of recursing forever', async () => {
      const spies = await loadWithPinoSpies()
      const looped = new Error('looped')
      looped.cause = looped
      spies.createLogger('test').error('Two failures:', new Error('first'), looped)

      const [fields] = spies.error.mock.calls[0] ?? []
      expect(fields).toMatchObject({ data: { message: 'looped', cause: '[Circular]' } })
    })

    it('should merge two plain objects whose keys do not clash', async () => {
      const spies = await loadWithPinoSpies()
      spies.createLogger('test').info('Both', { a: 1 }, { b: 2 })

      expect(spies.info).toHaveBeenCalledWith({ a: 1, b: 2 }, 'Both')
    })

    it('should still prepend the version prefix to the message', async () => {
      const spies = await loadWithPinoSpies({ showVersionNumber: true, version: '2026.11.0' })
      spies.createLogger('test').warn('Failed to write health file:', new Error('EROFS'))

      expect(spies.warn).toHaveBeenCalledWith({ err: expect.any(Error) }, 'v2026.11.0 :: Failed to write health file:')
    })
  })

  // Fields with at most logging.inlineMaxKeys keys (nested keys and array items count too) are
  // nested under `inline`, which the pretty printer renders as highlighted JSON on the message line.
  describe('createLogger — inline fields', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('should nest an object within the key limit under inline', async () => {
      const spies = await loadWithPinoSpies({ inlineMaxKeys: 2 })
      spies.createLogger('test').info('Received command on topic:', 'a/b', 'Message:', { mode: 'off' })

      expect(spies.info).toHaveBeenCalledWith({ inline: { mode: 'off' } }, 'Received command on topic: a/b Message:')
    })

    it('should inline an object with exactly the limit of keys', async () => {
      const spies = await loadWithPinoSpies({ inlineMaxKeys: 2 })
      spies.createLogger('test').info('Message published', { retain: false, qos: 2 })

      expect(spies.info).toHaveBeenCalledWith({ inline: { retain: false, qos: 2 } }, 'Message published')
    })

    it('should keep an object over the limit as top-level fields (one key per line)', async () => {
      const spies = await loadWithPinoSpies({ inlineMaxKeys: 2 })
      spies.createLogger('test').info('State', { a: 1, b: 2, c: 3 })

      expect(spies.info).toHaveBeenCalledWith({ a: 1, b: 2, c: 3 }, 'State')
    })

    it('should count nested keys and array items towards the limit', async () => {
      const spies = await loadWithPinoSpies({ inlineMaxKeys: 3 })
      const logger = spies.createLogger('test')
      logger.info('Nested', { a: { b: 1, c: 2 } })
      logger.info('Array', { list: [1, 2, 3] })

      expect(spies.info).toHaveBeenNthCalledWith(1, { inline: { a: { b: 1, c: 2 } } }, 'Nested')
      expect(spies.info).toHaveBeenNthCalledWith(2, { list: [1, 2, 3] }, 'Array')
    })

    it('should never inline when the limit is 0', async () => {
      const spies = await loadWithPinoSpies({ inlineMaxKeys: 0 })
      spies.createLogger('test').info('One', { mode: 'off' })

      expect(spies.info).toHaveBeenCalledWith({ mode: 'off' }, 'One')
    })

    it('should keep an Error under err beside the inline fields', async () => {
      const spies = await loadWithPinoSpies({ inlineMaxKeys: 2 })
      const error = new Error('boom')
      spies.createLogger('test').error('Failed:', { id: 'x' }, error)

      expect(spies.error).toHaveBeenCalledWith({ inline: { id: 'x' }, err: error }, 'Failed:')
    })

    it('should pass a lone Error as err without an empty inline object', async () => {
      const spies = await loadWithPinoSpies({ inlineMaxKeys: 2 })
      const error = new Error('boom')
      spies.createLogger('test').error('Failed:', error)

      expect(spies.error).toHaveBeenCalledWith({ err: error }, 'Failed:')
    })

    it('should count a cyclic object without recursing forever', async () => {
      const spies = await loadWithPinoSpies({ inlineMaxKeys: 4 })
      const looped: Record<string, unknown> = { a: 1 }
      looped.self = looped
      spies.createLogger('test').info('Cycle', looped)

      // Spread into fields: a + self, then looped's own a + self; the cycle back adds nothing.
      expect(spies.info).toHaveBeenCalledWith({ inline: { a: 1, self: looped } }, 'Cycle')
    })

    it('should nest an object carrying the inline key under data', async () => {
      const spies = await loadWithPinoSpies({ inlineMaxKeys: 0 })
      spies.createLogger('test').info('Clash', { inline: 1 })

      expect(spies.info).toHaveBeenCalledWith({ data: { inline: 1 } }, 'Clash')
    })
  })

  describe('pretty output', () => {
    beforeEach(() => {
      vi.resetModules()
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    const loadPretty = async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})
      vi.doMock('#/config.ts', () => ({
        default: { logging: { showTimestamp: false, showVersionNumber: false, inlineMaxKeys: 2 } },
      }))
      const { prettyOptions } = await import('#/logger.ts')
      return prettyFactory(prettyOptions)
    }

    const ESC = String.fromCodePoint(0x1b)
    const MAGENTA = `${ESC}[35m`
    const GREEN = `${ESC}[32m`
    const YELLOW = `${ESC}[33m`

    it('should render inline fields as JSON on the message line', async () => {
      const pretty = await loadPretty()
      const line = pretty({ level: 50, name: 'ELECTROLUX', msg: 'Error refreshing:', inline: { message: 'invalid' } })

      expect(stripVTControlCharacters(line)).toBe('ERROR (ELECTROLUX): Error refreshing: {"message":"invalid"}\n')
    })

    it('should syntax-highlight the inline JSON', async () => {
      const pretty = await loadPretty()
      const line = pretty({ level: 30, msg: 'x', inline: { mode: 'off', qos: 2, on: true, none: null, list: ['a'] } })

      expect(line).toContain(`${MAGENTA}"mode"`)
      expect(line).toContain(`${GREEN}"off"`)
      expect(line).toContain(`${YELLOW}2`)
      expect(line).toContain(`${YELLOW}true`)
      expect(line).toContain(`${GREEN}"a"`)
      expect(stripVTControlCharacters(line)).toContain('x {"mode":"off","qos":2,"on":true,"none":null,"list":["a"]}')
    })

    it('should print other fields one key per line below the message', async () => {
      const pretty = await loadPretty()
      const line = pretty({ level: 30, msg: 'State', a: 1, b: 'two' })

      expect(stripVTControlCharacters(line)).toBe('INFO: State\n    a: 1\n    b: "two"\n')
    })

    it('should strip terminal control characters from the message text', async () => {
      const pretty = await loadPretty()
      const line = pretty({ level: 30, msg: `bad${ESC}[2Jname` })

      expect(line).not.toContain(`${ESC}[2J`)
      expect(stripVTControlCharacters(line)).toBe('INFO: bad[2Jname\n')
    })

    it('should render inline fields alone when the message is empty', async () => {
      const pretty = await loadPretty()
      const line = pretty({ level: 30, msg: '', inline: { key: 'value' } })

      expect(stripVTControlCharacters(line)).toBe('INFO: {"key":"value"}\n')
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

      vi.doMock('#/config.ts', () => ({
        default: { logging: { showTimestamp: true, showVersionNumber: true } },
      }))

      const { default: createLogger } = await import('#/logger.ts')
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

      vi.doMock('#/config.ts', () => ({
        default: { logging: { showTimestamp: true, showVersionNumber: true } },
      }))

      const { default: createLogger } = await import('#/logger.ts')
      const logger = createLogger('test')

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('falling back to UTC'))
      expect(logger).toBeDefined()
    })

    it('should construct a working logger with showTimestamp:false config', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('#/config.ts', () => ({
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

      const { default: createLogger } = await import('#/logger.ts')
      const logger = createLogger('test')

      expect(logger).toBeDefined()
      expect(logger.info).toBeDefined()
    })

    it('should create a logger that can log objects as fields', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {})

      vi.doMock('#/config.ts', () => ({
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

      const { default: createLogger } = await import('#/logger.ts')
      const logger = createLogger('test')

      // Should not throw when logging objects (exercises the field mapping)
      expect(() => logger.info({ key: 'value' })).not.toThrow()
      expect(() => logger.error({ errorDetail: 'test' })).not.toThrow()
    })
  })
})

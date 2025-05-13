import pino from 'pino'

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
}).child({})

const createLogger = (name: string) => ({
  info: (...args: unknown[]) => baseLogger.info({ msg: `[${name.toUpperCase()}] :: ${stringifyArgs(args)}` }),
  error: (...args: unknown[]) => baseLogger.error({ msg: `[${name.toUpperCase()}] :: ${stringifyArgs(args)}` }),
  warn: (...args: unknown[]) => baseLogger.warn({ msg: `[${name.toUpperCase()}] :: ${stringifyArgs(args)}` }),
  debug: (...args: unknown[]) => baseLogger.debug({ msg: `[${name.toUpperCase()}] :: ${stringifyArgs(args)}` }),
})

const stringifyArgs = (args: unknown[]): string => {
  return args
    .map((arg) =>
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    )
    .join(' ')
}

export default createLogger

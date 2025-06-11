import util from 'node:util'
import pino from 'pino'

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
    },
  },
})

const stringifyArgs = (args: unknown[]): string => {
  return args
    .map((arg) => {
      if (typeof arg === 'object' && arg !== null) {
        // Colorize JSON using util.inspect
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return util.inspect(arg, { colors: true, depth: null })
      }
      return String(arg)
    })
    .join(' ')
}

const createLogger = (name: string) => {
  const logger = baseLogger.child({
    name: name.toUpperCase(),
  })

  return {
    info: (...args: unknown[]) => logger.info(stringifyArgs(args)),
    error: (...args: unknown[]) => logger.error(stringifyArgs(args)),
    warn: (...args: unknown[]) => logger.warn(stringifyArgs(args)),
    debug: (...args: unknown[]) => logger.debug(stringifyArgs(args)),
  }
}

export default createLogger

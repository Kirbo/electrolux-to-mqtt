import pino from 'pino'
import { version as packageVersion } from '../package.json'

const appVersion = process.env.APP_VERSION ?? packageVersion

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
}).child({})

const prefix = (name: string) => {
  const versionPrefix = appVersion !== 'development' ? `v${appVersion} :: ` : ''
  return `${versionPrefix}[${name.toUpperCase()}]`
}

const createLogger = (name: string) => ({
  info: (...args: unknown[]) => baseLogger.info({ msg: `${prefix(name)} :: ${stringifyArgs(args)}` }),
  error: (...args: unknown[]) => baseLogger.error({ msg: `${prefix(name)} :: ${stringifyArgs(args)}` }),
  warn: (...args: unknown[]) => baseLogger.warn({ msg: `${prefix(name)} :: ${stringifyArgs(args)}` }),
  debug: (...args: unknown[]) => baseLogger.debug({ msg: `${prefix(name)} :: ${stringifyArgs(args)}` }),
})

const stringifyArgs = (args: unknown[]): string => {
  return args.map((arg) => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg))).join(' ')
}

export default createLogger

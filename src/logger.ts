import fs from 'node:fs'
import util from 'node:util'
import pino from 'pino'
import packageJson from '../package.json' with { type: 'json' }
import config from './config.js'

const appVersion = packageJson.version

const getTimezone = () => {
  if (process.env.TZ) {
    console.log(`Using timezone from TZ env var: ${process.env.TZ}`)
    return process.env.TZ
  }
  try {
    const tz = fs.readFileSync('/etc/timezone', 'utf8').trim()
    console.log(`Using timezone from /etc/timezone: ${tz}`)
    return tz
  } catch {
    // Try macOS fallback: check /etc/localtime symlink
    try {
      const localtime = fs.readlinkSync('/etc/localtime')
      const match = new RegExp(/zoneinfo\/(.*)/).exec(localtime)
      if (match) {
        const tz = match[1]
        console.log(`Using timezone from /etc/localtime symlink: ${tz}`)
        return tz
      }
    } catch {
      console.warn('Could not detect timezone, falling back to UTC')
      return 'UTC'
    }
  }
}

const timeZone = getTimezone()

const baseLogger = pino({
  level: process.env.LOG_LEVEL || 'info',
  timestamp: () =>
    `,"time":"${new Date().toLocaleString(undefined, {
      timeZone,
    })}"`,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
    },
  },
})

const prefix = () => {
  const versionPrefix = appVersion === 'development' ? '' : `v${appVersion} :: `
  const showVersionNumber = config.logging?.showVersionNumber ?? true
  return showVersionNumber ? `${versionPrefix}` : ''
}

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
  const logPrefix = prefix()
  const logger = baseLogger.child({
    name: name.toUpperCase(),
  })

  return {
    info: (...args: unknown[]) => logger.info(`${logPrefix}${stringifyArgs(args)}`),
    error: (...args: unknown[]) => logger.error(`${logPrefix}${stringifyArgs(args)}`),
    warn: (...args: unknown[]) => logger.warn(`${logPrefix}${stringifyArgs(args)}`),
    debug: (...args: unknown[]) => logger.debug(`${logPrefix}${stringifyArgs(args)}`),
  }
}

export default createLogger

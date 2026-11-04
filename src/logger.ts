import fs from 'node:fs'
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
      const match = /zoneinfo\/(.*)/.exec(localtime)
      if (match) {
        const tz = match[1]
        console.log(`Using timezone from /etc/localtime symlink: ${tz}`)
        return tz
      }
    } catch {
      // /etc/localtime not readable
    }
    console.warn('Could not detect timezone, falling back to UTC')
    return 'UTC'
  }
}

const timeZone = getTimezone()

const showTimestamp = config.logging.showTimestamp

// sv-SE renders as `YYYY-MM-DD HH:mm:ss` — a fixed, locale-independent shape.
// Formatting with the server locale would produce strings pino-pretty cannot
// render consistently (e.g. fi_FI's `2.7.2026 klo 15.30.45`).
const formatTimestamp = () => new Date().toLocaleString('sv-SE', { timeZone })

const baseLogger = pino({
  // Log level comes from config only — env-mode installs route LOG_LEVEL through
  // envSchema into config; reading process.env here would mix env into YAML mode.
  level: config.logging.logLevel ?? 'info',
  timestamp: showTimestamp ? () => `,"time":"${formatTimestamp()}"` : false,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: showTimestamp ? 'pid,hostname' : 'pid,hostname,time',
      // time is already formatted above — re-parsing/translating would break it
      translateTime: false,
    },
  },
})

const prefix = () => {
  const versionPrefix = appVersion === 'development' ? '' : `v${appVersion} :: `
  const showVersionNumber = config.logging.showVersionNumber
  return showVersionNumber ? `${versionPrefix}` : ''
}

// Objects are handed to pino as structured fields: pino-pretty then prints each key on its
// own colored line. (Stringifying them into the message with util.inspect colors broke:
// pino-pretty strips the ESC byte inside msg, so log viewers showed raw `[33m…[39m`.)
type Fields = Record<string, unknown>
type Level = 'info' | 'warn' | 'error' | 'debug'

// Keys pino/pino-pretty own: spreading an object carrying one of them (an appliance's
// `name`, say) would overwrite the logger name, level or message.
const RESERVED_KEYS = new Set(['level', 'time', 'msg', 'pid', 'hostname', 'name', 'v', 'err'])

const isPlainObject = (value: object): value is Fields => {
  const proto: unknown = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// `data`, then `data2`, `data3`, … — the first key not already used.
const freeDataKey = (fields: Fields): string => {
  if (!('data' in fields)) return 'data'
  let n = 2
  while (`data${n}` in fields) n++
  return `data${n}`
}

// pino serializes only the `err` key as an error; any other Error would print as `{}`
// (message, stack and cause are non-enumerable), so extra Errors are flattened like pino's
// err. An Error cause is flattened the same way (a cycle ends as '[Circular]', like pino);
// any other cause is kept as-is.
const serializeError = (error: Error, seen = new Set<Error>()): Fields => {
  seen.add(error)
  const fields: Fields = { ...error, type: error.name, message: error.message, stack: error.stack }
  const { cause } = error
  if (cause instanceof Error) fields.cause = seen.has(cause) ? '[Circular]' : serializeError(cause, seen)
  else if (cause !== undefined) fields.cause = cause
  return fields
}

const addObject = (fields: Fields, value: object): void => {
  if (value instanceof Error) {
    if ('err' in fields) fields[freeDataKey(fields)] = serializeError(value)
    else fields.err = value // pino's err serializer + pino-pretty render message and stack
    return
  }
  if (isPlainObject(value) && Object.keys(value).every((k) => !RESERVED_KEYS.has(k) && !(k in fields))) {
    Object.assign(fields, value)
    return
  }
  fields[freeDataKey(fields)] = value
}

// Text and primitives form the message (in call order); objects become fields.
const splitArgs = (args: unknown[]): { fields: Fields; message: string } => {
  const fields: Fields = {}
  const parts: string[] = []
  for (const arg of args) {
    if (typeof arg === 'object' && arg !== null) addObject(fields, arg)
    else parts.push(String(arg))
  }
  return { fields, message: parts.join(' ') }
}

const createLogger = (name: string) => {
  const logPrefix = prefix()
  const logger = baseLogger.child({
    name: name.toUpperCase(),
  })

  const emit =
    (level: Level) =>
    (...args: unknown[]): void => {
      const { fields, message } = splitArgs(args)
      const msg = `${logPrefix}${message}`
      if (Object.keys(fields).length === 0) logger[level](msg)
      else logger[level](fields, msg)
    }

  return {
    info: emit('info'),
    error: emit('error'),
    warn: emit('warn'),
    debug: emit('debug'),
  }
}

export default createLogger

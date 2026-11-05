import fs from 'node:fs'
import pino from 'pino'
import type { MessageFormatFunc, PrettyOptions } from 'pino-pretty'
import pretty from 'pino-pretty'
import packageJson from '../package.json' with { type: 'json' }
import config from './config.ts'

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

// Fields small enough to print on the message line travel under this key: hidden from
// pino-pretty's one-key-per-line object output and rendered by formatMessage instead.
const INLINE_KEY = 'inline'

type Paint = (text: string) => string
interface JsonColors {
  magenta: Paint
  green: Paint
  yellow: Paint
  gray: Paint
}

// Compact JSON with keys magenta (as in the multi-line field output), strings green,
// numbers/booleans yellow and null gray. The value is already JSON-parsed by pino-pretty.
const highlightJson = (value: unknown, colors: JsonColors): string => {
  if (Array.isArray(value)) return `[${value.map((item) => highlightJson(item, colors)).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(
      ([key, item]) => `${colors.magenta(JSON.stringify(key))}:${highlightJson(item, colors)}`,
    )
    return `{${entries.join(',')}}`
  }
  if (typeof value === 'string') return colors.green(JSON.stringify(value))
  if (typeof value === 'number' || typeof value === 'boolean') return colors.yellow(String(value))
  return colors.gray('null') // the only JSON value left
}

// Same set pino-pretty strips from messages: C0/C1 controls except tab and newline. A function
// messageFormat bypasses that sanitizing, so it is re-applied to the message text here (the
// inline JSON needs no stripping — JSON.stringify escapes control characters).
const isUnsafeControlChar = (char: string): boolean => {
  const code = char.codePointAt(0) ?? 0
  return code <= 0x08 || (code >= 0x0b && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)
}
const stripUnsafeControlChars = (text: string): string =>
  Array.from(text)
    .filter((char) => !isUnsafeControlChar(char))
    .join('')

// A function (not a template) so its output keeps the inline JSON's color codes — pino-pretty
// strips ANSI escapes from a plain message.
const formatMessage: MessageFormatFunc = (log, messageKey, _levelLabel, { colors }) => {
  const raw = log[messageKey]
  const message = typeof raw === 'string' ? stripUnsafeControlChars(raw) : ''
  const inline = log[INLINE_KEY]
  if (inline === undefined) return message
  const json = highlightJson(inline, colors)
  return message === '' ? json : `${message} ${json}`
}

export const prettyOptions: PrettyOptions = {
  colorize: true,
  ignore: showTimestamp ? `pid,hostname,${INLINE_KEY}` : `pid,hostname,time,${INLINE_KEY}`,
  // time is already formatted above — re-parsing/translating would break it
  translateTime: false,
  messageFormat: formatMessage,
  // In-process (a transport worker cannot take the messageFormat function) and synchronous,
  // so the last lines before an exit are not lost.
  sync: true,
}

const baseLogger = pino(
  {
    // Log level comes from config only — env-mode installs route LOG_LEVEL through
    // envSchema into config; reading process.env here would mix env into YAML mode.
    level: config.logging.logLevel ?? 'info',
    timestamp: showTimestamp ? () => `,"time":"${formatTimestamp()}"` : false,
  },
  pretty(prettyOptions),
)

const prefix = () => {
  const versionPrefix = appVersion === 'development' ? '' : `v${appVersion} :: `
  const showVersionNumber = config.logging.showVersionNumber
  return showVersionNumber ? `${versionPrefix}` : ''
}

// Objects are handed to pino as structured fields: pino-pretty then prints each key on its
// own colored line — or, within logging.inlineMaxKeys, formatMessage prints them as highlighted
// JSON on the message line. (Stringifying them into the message with util.inspect colors broke:
// pino-pretty strips the ESC byte inside msg, so log viewers showed raw `[33m…[39m`.)
type Fields = Record<string, unknown>
type Level = 'info' | 'warn' | 'error' | 'debug'

// Keys pino/pino-pretty own: spreading an object carrying one of them (an appliance's
// `name`, say) would overwrite the logger name, level or message.
const RESERVED_KEYS = new Set(['level', 'time', 'msg', 'pid', 'hostname', 'name', 'v', 'err', INLINE_KEY])

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

// Object keys at every depth plus array items; a value already counted (a cycle) adds nothing.
const countKeys = (value: unknown, seen = new Set<object>()): number => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return 0
  seen.add(value)
  let children: unknown[] = []
  if (Array.isArray(value)) children = value
  else if (isPlainObject(value)) children = Object.values(value)
  return children.reduce<number>((total, child) => total + 1 + countKeys(child, seen), 0)
}

// Within the limit, every field but err moves under INLINE_KEY (err keeps pino's error
// rendering); otherwise the fields stay top-level, one key per line.
const layoutFields = (fields: Fields, inlineMaxKeys: number): Fields => {
  const { err, ...rest } = fields
  if (Object.keys(rest).length === 0 || countKeys(rest) > inlineMaxKeys) return fields
  return err === undefined ? { [INLINE_KEY]: rest } : { [INLINE_KEY]: rest, err }
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
  const { inlineMaxKeys } = config.logging
  const logger = baseLogger.child({
    name: name.toUpperCase(),
  })

  const emit =
    (level: Level) =>
    (...args: unknown[]): void => {
      const { fields, message } = splitArgs(args)
      const msg = `${logPrefix}${message}`
      if (Object.keys(fields).length === 0) logger[level](msg)
      else logger[level](layoutFields(fields, inlineMaxKeys), msg)
    }

  return {
    info: emit('info'),
    error: emit('error'),
    warn: emit('warn'),
    debug: emit('debug'),
  }
}

export default createLogger

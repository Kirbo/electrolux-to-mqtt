// Suppress console output during tests based on LOG_LEVEL environment variable
// By default (no LOG_LEVEL), suppress all output for clean test results
// If LOG_LEVEL is set, respect the logging level hierarchy:
//   debug   -> show everything (console.log, info, debug, warn, error)
//   info    -> show info, warn, error (suppress log, debug)
//   warn    -> show warn, error (suppress log, info, debug)
//   error   -> show error only (suppress log, info, warn, debug)
//   default -> suppress all

const logLevel = process.env.LOG_LEVEL?.toLowerCase() ?? 'off'

// Map of log level to the console methods that should be active
const levelMap: Record<string, Set<string>> = {
  debug: new Set(['log', 'info', 'debug', 'warn', 'error']),
  info: new Set(['info', 'warn', 'error']),
  warn: new Set(['warn', 'error']),
  error: new Set(['error']),
  off: new Set(), // suppress all
}

const activeLevel = levelMap[logLevel] ?? levelMap.off

// Store original functions
const originalLog = console.log
const originalInfo = console.info
const originalDebug = console.debug
const originalWarn = console.warn
const originalError = console.error

// Conditionally suppress console methods based on LOG_LEVEL
if (!activeLevel.has('log')) console.log = () => {}
if (!activeLevel.has('info')) console.info = () => {}
if (!activeLevel.has('debug')) console.debug = () => {}
if (!activeLevel.has('warn')) console.warn = () => {}
if (!activeLevel.has('error')) console.error = () => {}

export { originalLog, originalInfo, originalDebug, originalWarn, originalError }

import fs from 'node:fs/promises'
import path from 'node:path'
import createLogger from './logger.js'

const logger = createLogger('migrate')

export async function runStartupMigrations(): Promise<void> {
  await removeLegacyTokensFile()
}

async function removeLegacyTokensFile(): Promise<void> {
  // TODO: Safe to remove this function once v1.17.0 adoption is sufficient.
  // tokens.json persistence was dropped in v1.17.0 (commit 9afb1b6). This
  // cleanup runs on every startup but is a no-op once the file is gone.
  const filePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../tokens.json')
  try {
    await fs.unlink(filePath)
    logger.info('Removed legacy tokens.json (no longer used)')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
      logger.warn('Could not remove legacy tokens.json:', err)
    }
    // ENOENT = file doesn't exist — silent
  }
}

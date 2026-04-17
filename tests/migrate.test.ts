import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUnlink = vi.fn()

vi.mock('node:fs/promises', () => ({
  default: { unlink: mockUnlink },
}))

const mockInfo = vi.fn()
const mockWarn = vi.fn()

vi.mock('@/logger.js', () => ({
  default: () => ({
    info: mockInfo,
    warn: mockWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

describe('migrate', () => {
  beforeEach(() => {
    mockUnlink.mockReset()
    mockInfo.mockReset()
    mockWarn.mockReset()
  })

  describe('runStartupMigrations / removeLegacyTokensFile', () => {
    it('removes tokens.json when it exists and logs info', async () => {
      mockUnlink.mockResolvedValueOnce(undefined)

      const { runStartupMigrations } = await import('@/migrate.js')
      await runStartupMigrations()

      expect(mockUnlink).toHaveBeenCalledOnce()
      expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('legacy tokens.json'))
    })

    it('does nothing when tokens.json is missing (ENOENT)', async () => {
      const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
      mockUnlink.mockRejectedValueOnce(err)

      const { runStartupMigrations } = await import('@/migrate.js')
      await expect(runStartupMigrations()).resolves.toBeUndefined()

      expect(mockInfo).not.toHaveBeenCalled()
      expect(mockWarn).not.toHaveBeenCalled()
    })

    it('logs a warning for non-ENOENT errors but does not throw', async () => {
      const err = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
      mockUnlink.mockRejectedValueOnce(err)

      const { runStartupMigrations } = await import('@/migrate.js')
      await expect(runStartupMigrations()).resolves.toBeUndefined()

      expect(mockWarn).toHaveBeenCalledOnce()
      expect(mockInfo).not.toHaveBeenCalled()
    })
  })
})

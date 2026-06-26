import { describe, expect, it } from 'vitest'
import { validateLegacyBody } from '../src/validation.js'

const VALID_HASH = 'a'.repeat(64)
const VALID_VERSION = '1.2.3'

describe('validateLegacyBody', () => {
  describe('valid payloads', () => {
    it('accepts a complete valid body', () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: VALID_VERSION, channel: 'stable' })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.body.userHash).toBe(VALID_HASH)
        expect(result.body.version).toBe(VALID_VERSION)
        expect(result.body.channel).toBe('stable')
      }
    })

    it('accepts body without channel (optional)', () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: VALID_VERSION })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.body.channel).toBeUndefined()
      }
    })

    it("accepts channel='beta'", () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: VALID_VERSION, channel: 'beta' })
      expect(result.ok).toBe(true)
    })

    it('accepts version with leading v', () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: 'v1.2.3' })
      expect(result.ok).toBe(true)
    })

    it('accepts CalVer beta version', () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: '2026.6.0b1' })
      expect(result.ok).toBe(true)
    })

    it('accepts semver pre-release version', () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: '1.2.3-rc.1' })
      expect(result.ok).toBe(true)
    })

    it('tolerates extra unknown fields', () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: VALID_VERSION, extra: 'ignored' })
      expect(result.ok).toBe(true)
    })
  })

  describe('invalid userHash', () => {
    it('rejects missing userHash', () => {
      const result = validateLegacyBody({ version: VALID_VERSION })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/userHash/)
    })

    it('rejects userHash that is too short', () => {
      const result = validateLegacyBody({ userHash: 'a'.repeat(63), version: VALID_VERSION })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/userHash/)
    })

    it('rejects userHash that is too long', () => {
      const result = validateLegacyBody({ userHash: 'a'.repeat(65), version: VALID_VERSION })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/userHash/)
    })

    it('rejects userHash with uppercase hex', () => {
      const result = validateLegacyBody({ userHash: 'A'.repeat(64), version: VALID_VERSION })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/userHash/)
    })

    it('rejects userHash with non-hex characters', () => {
      const result = validateLegacyBody({ userHash: 'z'.repeat(64), version: VALID_VERSION })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/userHash/)
    })

    it('rejects non-string userHash', () => {
      const result = validateLegacyBody({ userHash: 12345, version: VALID_VERSION })
      expect(result.ok).toBe(false)
    })
  })

  describe('invalid version', () => {
    it('rejects missing version', () => {
      const result = validateLegacyBody({ userHash: VALID_HASH })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/version/)
    })

    it('rejects version longer than 32 characters', () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: `1.2.3-${'a'.repeat(28)}` })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/version/)
    })

    it('rejects version that does not match semver/calver pattern', () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: 'not-a-version' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/version/)
    })

    it('rejects empty version string', () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: '' })
      expect(result.ok).toBe(false)
    })

    it('rejects non-string version', () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: 123 })
      expect(result.ok).toBe(false)
    })
  })

  describe('invalid channel', () => {
    it("rejects channel='unknown'", () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: VALID_VERSION, channel: 'unknown' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/channel/)
    })

    it('rejects numeric channel', () => {
      const result = validateLegacyBody({ userHash: VALID_HASH, version: VALID_VERSION, channel: 1 })
      expect(result.ok).toBe(false)
    })
  })

  describe('invalid body structure', () => {
    it('rejects null body', () => {
      const result = validateLegacyBody(null)
      expect(result.ok).toBe(false)
    })

    it('rejects array body', () => {
      const result = validateLegacyBody([])
      expect(result.ok).toBe(false)
    })

    it('rejects string body', () => {
      const result = validateLegacyBody('hello')
      expect(result.ok).toBe(false)
    })
  })
})

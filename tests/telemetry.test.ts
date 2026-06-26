import { describe, expect, it, vi } from 'vitest'
import type { BaseAppliance } from '@/appliances/base.js'
import { getOsInfo, mapOsName, summarizeAppliances } from '@/telemetry.js'

vi.mock('node:os', () => ({
  default: {
    platform: vi.fn(() => 'linux'),
    release: vi.fn(() => '5.15.0'),
    arch: vi.fn(() => 'arm64'),
  },
}))

describe('mapOsName', () => {
  it('maps linux to Linux', () => {
    expect(mapOsName('linux')).toBe('Linux')
  })

  it('maps darwin to macOS', () => {
    expect(mapOsName('darwin')).toBe('macOS')
  })

  it('maps win32 to Windows', () => {
    expect(mapOsName('win32')).toBe('Windows')
  })

  it('returns raw platform for unknown values', () => {
    expect(mapOsName('freebsd')).toBe('freebsd')
  })

  it('returns raw platform for empty string', () => {
    expect(mapOsName('')).toBe('')
  })
})

describe('getOsInfo', () => {
  it('returns osName, osVersion, and arch', async () => {
    const os = await import('node:os')
    vi.mocked(os.default.platform).mockReturnValue('linux' as NodeJS.Platform)
    vi.mocked(os.default.release).mockReturnValue('5.15.0')
    vi.mocked(os.default.arch).mockReturnValue('arm64')

    const info = getOsInfo()
    expect(info.osName).toBe('Linux')
    expect(info.osVersion).toBe('5.15.0')
    expect(info.arch).toBe('arm64')
  })

  it('maps darwin platform to macOS in osName', async () => {
    const os = await import('node:os')
    vi.mocked(os.default.platform).mockReturnValue('darwin' as NodeJS.Platform)

    const info = getOsInfo()
    expect(info.osName).toBe('macOS')
  })

  it('maps win32 platform to Windows in osName', async () => {
    const os = await import('node:os')
    vi.mocked(os.default.platform).mockReturnValue('win32' as NodeJS.Platform)

    const info = getOsInfo()
    expect(info.osName).toBe('Windows')
  })
})

describe('summarizeAppliances', () => {
  const makeAppliance = (modelName: string): BaseAppliance =>
    ({ getModelName: () => modelName }) as unknown as BaseAppliance

  it('returns empty string and count 0 for empty map', () => {
    const result = summarizeAppliances(new Map())
    expect(result).toEqual({ models: '', count: 0 })
  })

  it('returns single model name and count 1 for one appliance', () => {
    const map = new Map([['id1', makeAppliance('COMFORT600')]])
    const result = summarizeAppliances(map)
    expect(result).toEqual({ models: 'COMFORT600', count: 1 })
  })

  it('returns comma-joined sorted model names for multiple appliances', () => {
    const map = new Map([
      ['id1', makeAppliance('COMFORT600')],
      ['id2', makeAppliance('AIRPURIFIER')],
    ])
    const result = summarizeAppliances(map)
    expect(result.models).toBe('AIRPURIFIER,COMFORT600')
    expect(result.count).toBe(2)
  })

  it('de-duplicates models that appear multiple times', () => {
    const map = new Map([
      ['id1', makeAppliance('COMFORT600')],
      ['id2', makeAppliance('COMFORT600')],
      ['id3', makeAppliance('COMFORT600')],
    ])
    const result = summarizeAppliances(map)
    expect(result.models).toBe('COMFORT600')
    expect(result.count).toBe(3)
  })

  it('sorts models alphabetically', () => {
    const map = new Map([
      ['id1', makeAppliance('ZEBRA')],
      ['id2', makeAppliance('ALPHA')],
      ['id3', makeAppliance('MIDDLE')],
    ])
    const result = summarizeAppliances(map)
    expect(result.models).toBe('ALPHA,MIDDLE,ZEBRA')
  })

  it('count reflects total appliance instances, not unique model count', () => {
    const map = new Map([
      ['id1', makeAppliance('COMFORT600')],
      ['id2', makeAppliance('COMFORT600')],
      ['id3', makeAppliance('AIRPURIFIER')],
    ])
    const result = summarizeAppliances(map)
    expect(result.count).toBe(3)
    expect(result.models).toBe('AIRPURIFIER,COMFORT600')
  })
})

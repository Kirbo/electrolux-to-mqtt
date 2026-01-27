import { describe, expect, it, vi } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }
import init from '../src/init.js'

describe('init', () => {
  it('should log the application version', async () => {
    const consoleInfoSpy = vi.spyOn(console, 'info')
    init()
    expect(consoleInfoSpy).toHaveBeenCalledWith(`Starting Electrolux to MQTT version: "${packageJson.version}"`)
    consoleInfoSpy.mockRestore()
  })

  it('should call console.info exactly once', () => {
    const consoleInfoSpy = vi.spyOn(console, 'info')
    init()
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1)
    consoleInfoSpy.mockRestore()
  })
})

import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { AptabaseForwarder } from '../src/aptabase.js'
import type { BadgeStore } from '../src/badge-store.js'
import { createRateLimiter } from '../src/rate-limit.js'
import { startServer } from '../src/server.js'

const store: BadgeStore = {
  regenerate: async () => ({ telemetryOk: true, releasesOk: true }),
  getTelemetryJson: () => '{"total":1}',
  getStableTag: () => null,
  getBetaTag: () => null,
}
const forwarder: AptabaseForwarder = { forward: async () => {} }

describe('startServer', () => {
  it('binds the port, logs the address and serves requests', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const server = startServer(store, forwarder, createRateLimiter(10, 60_000), 'https://example.com', 0, '1.0.0')
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve))
      const { port } = server.address() as AddressInfo
      expect(port).toBeGreaterThan(0)
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Listening on port'))
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      expect(res.status).toBe(200)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      log.mockRestore()
    }
  })
})

import http from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { buildRateLimitSalt, createShutdownHandler } from '../src/startup.js'

// ── buildRateLimitSalt ────────────────────────────────────────────────────────
describe('buildRateLimitSalt', () => {
  it('returns RATE_LIMIT_SALT when set', () => {
    const salt = buildRateLimitSalt({
      env: { RATE_LIMIT_SALT: 'my-secret' },
      machineId: null,
      hostname: 'host',
      nodeEnv: 'production',
    })
    expect(salt).toBe('my-secret')
  })

  it('returns machine-id when RATE_LIMIT_SALT is unset', () => {
    const salt = buildRateLimitSalt({
      env: {},
      machineId: 'machine-abc',
      hostname: 'host',
      nodeEnv: 'production',
    })
    expect(salt).toBe('machine-abc')
  })

  it('falls back to hostname outside production when both RATE_LIMIT_SALT and machine-id are absent', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const salt = buildRateLimitSalt({
      env: {},
      machineId: null,
      hostname: 'my-host',
      nodeEnv: 'development',
    })
    expect(salt).toBe('my-host')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('RATE_LIMIT_SALT is unset'))
    warnSpy.mockRestore()
  })

  it('writes to stderr and calls process.exit(1) in production when no salt is available', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code) => {
      throw new Error('process.exit called')
    })

    expect(() =>
      buildRateLimitSalt({
        env: {},
        machineId: null,
        hostname: 'host',
        nodeEnv: 'production',
      }),
    ).toThrow('process.exit called')

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('FATAL'))
    expect(exitSpy).toHaveBeenCalledWith(1)

    stderrSpy.mockRestore()
    exitSpy.mockRestore()
  })
})

// ── createShutdownHandler ─────────────────────────────────────────────────────
describe('createShutdownHandler', () => {
  it('calls server.close(), redis.quit(), and exit(0) on clean shutdown', async () => {
    // Use a mock server so we avoid real network listen (sandbox-safe)
    let closeCalled = false
    const mockServer = {
      close: (cb?: (err?: Error) => void) => {
        closeCalled = true
        setImmediate(() => cb?.())
      },
    } as unknown as http.Server

    const quitMock = vi.fn().mockResolvedValue(undefined)
    const exitMock = vi.fn()

    const shutdown = createShutdownHandler(mockServer, { quit: quitMock }, { exit: exitMock })
    await shutdown()

    expect(closeCalled).toBe(true)
    expect(quitMock).toHaveBeenCalledOnce()
    expect(exitMock).toHaveBeenCalledWith(0)
  })

  it('calls exit(1) when server.close times out', async () => {
    // Server whose close callback never fires — simulates hanging keep-alive connections
    const neverCloseServer = {
      close: (_cb?: (err?: Error) => void) => {
        // Never call the callback
      },
    } as unknown as http.Server

    const quitMock = vi.fn().mockResolvedValue(undefined)
    const exitMock = vi.fn()

    const shutdown = createShutdownHandler(neverCloseServer, { quit: quitMock }, { timeoutMs: 10, exit: exitMock })
    await shutdown()

    // Timed out — exit(1), not exit(0)
    expect(exitMock).toHaveBeenCalledWith(1)
  })

  it('calls exit(1) when redis.quit throws', async () => {
    const mockServer = {
      close: (cb?: (err?: Error) => void) => setImmediate(() => cb?.()),
    } as unknown as http.Server

    const quitMock = vi.fn().mockRejectedValue(new Error('redis quit failed'))
    const exitMock = vi.fn()

    const shutdown = createShutdownHandler(mockServer, { quit: quitMock }, { exit: exitMock })
    await shutdown()

    expect(exitMock).toHaveBeenCalledWith(1)
  })

  it('calls quit() only after server finishes closing (ordering)', async () => {
    const callOrder: string[] = []

    const mockServer = {
      close: (cb?: (err?: Error) => void) => {
        callOrder.push('server.close called')
        setImmediate(() => {
          callOrder.push('server.close resolved')
          cb?.()
        })
      },
    } as unknown as http.Server

    const quitMock = vi.fn().mockImplementation(async () => {
      callOrder.push('redis.quit called')
    })
    const exitMock = vi.fn().mockImplementation((code: number) => {
      callOrder.push(`exit(${code})`)
    })

    const shutdown = createShutdownHandler(mockServer, { quit: quitMock }, { exit: exitMock })
    await shutdown()

    expect(callOrder).toEqual(['server.close called', 'server.close resolved', 'redis.quit called', 'exit(0)'])
  })

  it('drains an in-flight request before shutting down', async () => {
    // Real listening server that delays 50 ms before responding — proves
    // server.close() waits for the in-flight request to finish.
    const server = http.createServer((_req, res) => {
      setTimeout(() => res.end('done'), 50)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    const addr = server.address() as { port: number }

    // Non-keep-alive agent so the idle connection doesn't block server.close().
    const agent = new http.Agent({ keepAlive: false })
    const reqPromise = new Promise<string>((resolve) => {
      http.get({ host: '127.0.0.1', port: addr.port, agent }, (res) => {
        let body = ''
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        res.on('end', () => resolve(body))
      })
    })

    // Give the request a moment to reach the server before we start shutting down.
    await new Promise((r) => setTimeout(r, 10))

    const quitMock = vi.fn().mockResolvedValue(undefined)
    const exitMock = vi.fn()

    const shutdown = createShutdownHandler(server, { quit: quitMock }, { timeoutMs: 5_000, exit: exitMock })

    const [body] = await Promise.all([reqPromise, shutdown()])

    expect(body).toBe('done')
    expect(exitMock).toHaveBeenCalledWith(0)
  })
})

import http from 'node:http'
import type { AptabaseForwarder } from './aptabase.js'
import { buildAptabaseEvent } from './aptabase.js'
import type { BadgeStore } from './badge-store.js'
import { extractClientIp } from './ip.js'
import type { RateLimiter } from './rate-limit.js'
import { validateLegacyBody } from './validation.js'

const JSON_CONTENT_TYPE = 'application/json'
const SVG_CONTENT_TYPE = 'image/svg+xml'

const NO_CACHE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': JSON_CONTENT_TYPE })
  res.end(payload)
}

/**
 * Max accepted POST body. Legacy bodies are ~150 B; the cap stops an oversized
 * request from exhausting memory on the (64 MB) container.
 */
const MAX_BODY_BYTES = 8 * 1024

type ReadBodyResult = { ok: true; body: string } | { ok: false; reason: 'too_large' | 'error' }

function readBody(req: http.IncomingMessage, maxBytes: number): Promise<ReadBodyResult> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (result: ReadBodyResult): void => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }

    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > maxBytes) {
      settle({ ok: false, reason: 'too_large' })
      return
    }

    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        settle({ ok: false, reason: 'too_large' })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => settle({ ok: true, body: Buffer.concat(chunks).toString('utf8') }))
    req.on('error', () => settle({ ok: false, reason: 'error' }))
  })
}

function handleSvg(res: http.ServerResponse, svg: string | null): void {
  if (svg === null) {
    res.writeHead(503, { 'Content-Type': 'text/plain' })
    res.end('Not yet ready')
    return
  }
  res.writeHead(200, { 'Content-Type': SVG_CONTENT_TYPE, ...NO_CACHE_HEADERS })
  res.end(svg)
}

function handleTelemetryJson(res: http.ServerResponse, json: string | null): void {
  if (json === null) {
    res.writeHead(503, { 'Content-Type': 'text/plain' })
    res.end('Not yet ready')
    return
  }
  res.writeHead(200, { 'Content-Type': JSON_CONTENT_TYPE, ...NO_CACHE_HEADERS })
  res.end(json)
}

function handleHealth(res: http.ServerResponse): void {
  writeJson(res, 200, { status: 'ok' })
}

async function handleLegacyTelemetry(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  forwarder: AptabaseForwarder,
  limiter: RateLimiter,
  serviceVersion: string,
): Promise<void> {
  const clientIp = extractClientIp(req.headers, req.socket.remoteAddress)

  if (!limiter.allow(clientIp)) {
    writeJson(res, 429, { error: 'Too Many Requests' })
    return
  }

  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.includes(JSON_CONTENT_TYPE)) {
    writeJson(res, 415, { error: 'Content-Type must be application/json' })
    return
  }

  const bodyResult = await readBody(req, MAX_BODY_BYTES)
  if (!bodyResult.ok) {
    if (bodyResult.reason === 'too_large') {
      // Connection: close discards any unconsumed body so it can't desync keep-alive.
      res.writeHead(413, { 'Content-Type': JSON_CONTENT_TYPE, Connection: 'close' })
      res.end(JSON.stringify({ error: 'Payload Too Large' }))
      return
    }
    writeJson(res, 400, { error: 'Failed to read request body' })
    return
  }
  const rawBody = bodyResult.body

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    writeJson(res, 400, { error: 'Invalid JSON' })
    return
  }

  const validation = validateLegacyBody(parsed)
  if (!validation.ok) {
    writeJson(res, 400, { error: validation.error })
    return
  }

  // Respond immediately — forwarding is best-effort
  res.writeHead(204)
  res.end()

  const event = buildAptabaseEvent(validation.body, serviceVersion)
  try {
    await forwarder.forward(event, clientIp)
  } catch (err) {
    console.error('[telemetry-backend] Failed to forward event to Aptabase:', err)
  }
}

/**
 * Create the combined telemetry-backend HTTP server with injected dependencies.
 *
 * Routes:
 *   GET /              → 302 /users.svg
 *   GET /users.svg     → in-memory SVG (no-cache) or 503
 *   GET /stable.svg    → in-memory SVG (no-cache) or 503
 *   GET /beta.svg      → in-memory SVG (no-cache) or 503
 *   GET /telemetry.json → in-memory JSON (no-cache) or 503
 *   POST /telemetry    → legacy ingest: validate → rate-limit → forward → 204
 *   GET /health        → 200 { status: 'ok' }
 *   *                  → 404
 */
export function createServer(
  store: BadgeStore,
  forwarder: AptabaseForwarder,
  limiter: RateLimiter,
  serviceVersion: string,
): http.Server {
  return http.createServer((req, res) => {
    const method = req.method ?? 'GET'
    const url = req.url ?? '/'

    if (url === '/health') {
      handleHealth(res)
      return
    }

    if (url === '/') {
      res.writeHead(302, { Location: '/users.svg' })
      res.end()
      return
    }

    if (url === '/users.svg') {
      handleSvg(res, store.getUsersSvg())
      return
    }

    if (url === '/stable.svg') {
      handleSvg(res, store.getStableSvg())
      return
    }

    if (url === '/beta.svg') {
      handleSvg(res, store.getBetaSvg())
      return
    }

    if (url === '/telemetry.json') {
      handleTelemetryJson(res, store.getTelemetryJson())
      return
    }

    if (url === '/telemetry') {
      if (method !== 'POST') {
        res.writeHead(405, { Allow: 'POST' })
        res.end()
        return
      }
      void handleLegacyTelemetry(req, res, forwarder, limiter, serviceVersion)
      return
    }

    res.writeHead(404)
    res.end()
  })
}

/** Start the server and log the bound address. */
export function startServer(
  store: BadgeStore,
  forwarder: AptabaseForwarder,
  limiter: RateLimiter,
  port: number,
  serviceVersion: string,
): http.Server {
  const server = createServer(store, forwarder, limiter, serviceVersion)
  server.listen(port, '0.0.0.0', () => {
    console.log(`[telemetry-backend] Listening on port ${port}`)
  })
  return server
}

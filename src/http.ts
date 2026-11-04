/**
 * Minimal JSON-over-fetch helper (Node's built-in fetch — no HTTP client dependency).
 *
 * Every request has a timeout. A non-2xx response or a transport failure throws an
 * HttpError whose message reads like the old axios one, plus the status, method and
 * path, and a short response body when there is one.
 */

const ERROR_BODY_MAX_LENGTH = 200

export interface HttpRequest {
  method?: 'GET' | 'POST' | 'PUT'
  url: string
  headers?: Record<string, string>
  /** Serialized as JSON (and Content-Type set) unless it is already a string. */
  body?: unknown
  timeoutMs: number
}

export interface HttpResponse {
  status: number
  headers: Headers
  data: unknown
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly url: string,
    readonly status?: number,
    readonly statusText?: string,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = 'HttpError'
  }

  /** e.g. `Request failed with status code 404 (404 Not Found) [GET /api/v1/x] - {"error":"…"}` */
  describe(): string {
    let text = this.message
    if (this.status !== undefined) {
      text += ` (${this.status}${this.statusText ? ` ${this.statusText}` : ''})`
    }
    text += ` [${this.method} ${urlPath(this.url)}]`
    if (typeof this.data === 'object' && this.data !== null) {
      const body = JSON.stringify(this.data)
      if (body.length < ERROR_BODY_MAX_LENGTH) text += ` - ${body}`
    }
    return text
  }
}

/** Human-readable one-liner for any error thrown around an HTTP call. */
export function describeError(error: unknown): string {
  if (error instanceof HttpError) return error.describe()
  if (error instanceof Error) return error.message
  return String(error)
}

function urlPath(url: string): string {
  return URL.canParse(url) ? new URL(url).pathname : url
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return null
  try {
    return JSON.parse(text)
  } catch {
    // Not JSON (an HTML error page, plain text) — keep the raw text for the caller.
    return text
  }
}

export async function httpRequest(request: HttpRequest): Promise<HttpResponse> {
  const method = request.method ?? 'GET'
  const headers: Record<string, string> = { ...request.headers }
  let body: string | undefined
  if (request.body !== undefined) {
    body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body)
    headers['Content-Type'] ??= 'application/json'
  }

  let response: Response
  try {
    response = await fetch(request.url, { method, headers, body, signal: AbortSignal.timeout(request.timeoutMs) })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ''
    throw new HttpError(`${reason}${cause}`, method, request.url)
  }

  const data = await readBody(response)
  if (!response.ok) {
    throw new HttpError(
      `Request failed with status code ${response.status}`,
      method,
      request.url,
      response.status,
      response.statusText,
      data,
    )
  }
  return { status: response.status, headers: response.headers, data }
}

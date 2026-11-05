/**
 * Minimal JSON-over-fetch helper (Node's built-in fetch — no HTTP client dependency).
 *
 * Every request has a timeout. A non-2xx response or a transport failure throws an
 * HttpError whose message reads like the old axios one, plus the status, method and
 * path; describeError adds a short response body when there is one.
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
  readonly method: string
  readonly url: string
  readonly status: number | undefined
  readonly statusText: string | undefined
  readonly data: unknown

  constructor(message: string, method: string, url: string, status?: number, statusText?: string, data?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.method = method
    this.url = url
    this.status = status
    this.statusText = statusText
    this.data = data
  }

  /** e.g. `Request failed with status code 404 (404 Not Found) [GET /api/v1/x]` */
  describe(): string {
    let text = this.message
    if (this.status !== undefined) {
      text += ` (${this.status}${this.statusText ? ` ${this.statusText}` : ''})`
    }
    return `${text} [${this.method} ${urlPath(this.url)}]`
  }

  /** The response body when it is a JSON object/array short enough to log, else undefined. */
  shortBody(): object | undefined {
    if (typeof this.data !== 'object' || this.data === null) return undefined
    return JSON.stringify(this.data).length < ERROR_BODY_MAX_LENGTH ? this.data : undefined
  }
}

/**
 * Logger arguments for any error thrown around an HTTP call: a one-line description, then a
 * short response body as its own argument, so the logger prints it as highlighted JSON —
 * `logger.error('Error logging in:', ...describeError(error))`.
 */
export function describeError(error: unknown): [string] | [string, object] {
  if (error instanceof HttpError) {
    const body = error.shortBody()
    return body === undefined ? [error.describe()] : [`${error.describe()} -`, body]
  }
  if (error instanceof Error) return [error.message]
  return [String(error)]
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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeError, HttpError, httpRequest } from '#/http.ts'

const fetchMock = vi.fn<typeof fetch>()
vi.stubGlobal('fetch', fetchMock)

afterEach(() => {
  fetchMock.mockReset()
})

const respond = (body: string, init: ResponseInit = {}) => fetchMock.mockResolvedValueOnce(new Response(body, init))

describe('httpRequest', () => {
  it('returns status, headers and the parsed JSON body', async () => {
    respond('{"ok":true}', { status: 200, headers: { 'x-csrf-token': 'abc' } })

    const response = await httpRequest({ url: 'https://api.example/x', timeoutMs: 1000 })

    expect(response.status).toBe(200)
    expect(response.data).toEqual({ ok: true })
    expect(response.headers.get('x-csrf-token')).toBe('abc')
  })

  it('sends a JSON body with Content-Type, the method, headers and a timeout signal', async () => {
    respond('{}')

    await httpRequest({
      method: 'POST',
      url: 'https://api.example/login',
      headers: { 'x-api-key': 'k' },
      body: { a: 1 },
      timeoutMs: 1000,
    })

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://api.example/login')
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"a":1}',
      headers: { 'x-api-key': 'k', 'Content-Type': 'application/json' },
    })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends a string body as-is without forcing JSON', async () => {
    respond('')

    await httpRequest({ method: 'POST', url: 'https://ntfy.example/t', body: 'hello', timeoutMs: 1000 })

    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.body).toBe('hello')
  })

  it('returns null for an empty body and the raw text for a non-JSON body', async () => {
    respond('')
    respond('<html>hi</html>')

    expect((await httpRequest({ url: 'https://a/1', timeoutMs: 1000 })).data).toBeNull()
    expect((await httpRequest({ url: 'https://a/2', timeoutMs: 1000 })).data).toBe('<html>hi</html>')
  })

  it('throws an HttpError carrying status and body for a non-2xx response', async () => {
    respond('{"error":"nope"}', { status: 404, statusText: 'Not Found' })

    const error = await httpRequest({ url: 'https://api.example/api/v1/x', timeoutMs: 1000 }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ status: 404, method: 'GET', data: { error: 'nope' } })
    expect(describeError(error)).toBe(
      'Request failed with status code 404 (404 Not Found) [GET /api/v1/x] - {"error":"nope"}',
    )
  })

  it('wraps a transport failure (DNS, refused, timeout) in an HttpError without a status', async () => {
    fetchMock.mockRejectedValueOnce(
      new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND api.example') }),
    )

    const error = await httpRequest({ method: 'PUT', url: 'https://api.example/c', timeoutMs: 1000 }).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ status: undefined, method: 'PUT' })
    expect(describeError(error)).toBe('fetch failed: getaddrinfo ENOTFOUND api.example [PUT /c]')
  })

  it('aborts a request that exceeds its timeout', async () => {
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )

    const error = await httpRequest({ url: 'https://slow.example/', timeoutMs: 20 }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(HttpError)
    expect(describeError(error)).toContain('timeout')
  })
})

describe('describeError', () => {
  it('omits a large response body', () => {
    const big = { text: 'x'.repeat(300) }
    expect(new HttpError('boom', 'GET', 'https://a/b', 500, 'Server Error', big).describe()).toBe(
      'boom (500 Server Error) [GET /b]',
    )
  })

  it('falls back to the message or string form for non-HTTP errors', () => {
    expect(describeError(new Error('plain'))).toBe('plain')
    expect(describeError('text')).toBe('text')
  })
})

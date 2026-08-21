import { describe, expect, it, vi } from 'vitest'
import { SendDock } from './client.js'
import { SendDockError } from './error.js'

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function makeClient(fetchImpl: typeof fetch, maxRetries = 0) {
  return new SendDock({
    baseUrl: 'https://mail.example.com',
    apiKey: 'sk_test_123',
    projectId: 'proj-1',
    fetch: fetchImpl,
    maxRetries,
  })
}

describe('constructor validation', () => {
  it.each([
    ['baseUrl', { baseUrl: '', apiKey: 'sk', projectId: 'p' }],
    ['apiKey', { baseUrl: 'https://x.com', apiKey: '', projectId: 'p' }],
    ['projectId', { baseUrl: 'https://x.com', apiKey: 'sk', projectId: '' }],
  ])('throws synchronously when %s is missing', (_field, opts) => {
    expect(() => new SendDock(opts)).toThrow()
  })

  it('normalizes a trailing slash in baseUrl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    const sd = new SendDock({
      baseUrl: 'https://mail.example.com///',
      apiKey: 'sk',
      projectId: 'p',
      fetch: fetchMock,
    })
    await sd.stats()
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://mail.example.com/api/v1/projects/p/stats',
    )
  })
})

describe('network failures', () => {
  it('wraps a connection failure in SendDockError instead of leaking a raw TypeError', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    const sd = makeClient(fetchMock)

    const err = await sd.stats().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SendDockError)
    expect((err as SendDockError).status).toBe(0)
    expect((err as SendDockError).isNetworkError).toBe(true)
    expect((err as SendDockError).message).toContain('fetch failed')
  })

  it('retries network failures before giving up', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(jsonResponse(200, { message: 'sent' }))
      const sd = makeClient(fetchMock, 2)

      const pending = sd.send({ to: 'a@example.com', template_id: 't-1' })
      await vi.advanceTimersByTimeAsync(500)

      expect(await pending).toEqual({ message: 'sent' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a timeout as a SendDockError naming the limit', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException('signal timed out', 'TimeoutError'))
    const sd = makeClient(fetchMock)

    const err = await sd.stats().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SendDockError)
    expect((err as SendDockError).message).toBe('request timed out after 30000ms')
  })

  it('passes an abort signal so hung requests cannot hang forever', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    const sd = makeClient(fetchMock)

    await sd.stats()

    const [, init] = fetchMock.mock.calls[0]!
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('malformed server responses', () => {
  it('wraps invalid JSON on a 2xx instead of leaking a SyntaxError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }))
    const sd = makeClient(fetchMock)

    const err = await sd.stats().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SendDockError)
    expect((err as SendDockError).message).toBe('the server returned a non-JSON response body')
  })

  it('handles a non-JSON error body without crashing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('Bad Gateway', { status: 502 }))
    const sd = makeClient(fetchMock)

    const err = await sd.stats().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SendDockError)
    expect((err as SendDockError).status).toBe(502)
    expect((err as SendDockError).message).toBe('request failed with status 502')
  })

  it('handles an error body whose error field is not a string', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: { nested: true } }))
    const sd = makeClient(fetchMock)

    const err = await sd.stats().catch((e: unknown) => e)

    expect((err as SendDockError).message).toBe('request failed with status 400')
    expect((err as SendDockError).body).toEqual({ error: { nested: true } })
  })
})

describe('retry exhaustion', () => {
  it('throws the last error after exhausting retries on 5xx', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi
        .fn()
        .mockImplementation(() => Promise.resolve(jsonResponse(503, { error: 'unavailable' })))
      const sd = makeClient(fetchMock, 2)

      const pending = sd.stats().catch((e: unknown) => e)
      await vi.advanceTimersByTimeAsync(10_000)
      const err = await pending

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect((err as SendDockError).status).toBe(503)
      expect((err as SendDockError).message).toBe('unavailable')
    } finally {
      vi.useRealTimers()
    }
  })

  it('caps a hostile Retry-After at 60 seconds', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(429, { error: 'slow down' }, { 'Retry-After': '86400' }),
        )
        .mockResolvedValueOnce(jsonResponse(200, {}))
      const sd = makeClient(fetchMock, 1)

      const pending = sd.stats()
      await vi.advanceTimersByTimeAsync(60_000)

      await expect(pending).resolves.toEqual({})
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never retries 4xx client errors even with retries configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(404, { error: 'project not found' }))
    const sd = makeClient(fetchMock, 3)

    const err = await sd.stats().catch((e: unknown) => e)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((err as SendDockError).isNotFound).toBe(true)
  })
})

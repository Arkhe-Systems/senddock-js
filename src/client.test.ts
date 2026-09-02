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
    baseUrl: 'https://mail.example.com/',
    apiKey: 'sk_test_123',
    projectId: 'proj-1',
    fetch: fetchImpl,
    maxRetries,
  })
}

describe('SendDock client', () => {
  it('sends the API key and hits the project-scoped path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { message: 'sent' }))
    const sd = makeClient(fetchMock)

    const result = await sd.send({ to: 'a@example.com', template_id: 't-1' })

    expect(result).toEqual({ message: 'sent' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://mail.example.com/api/v1/projects/proj-1/send')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sk_test_123')
    expect(JSON.parse(init.body)).toEqual({ to: 'a@example.com', template_id: 't-1' })
  })

  it('passes through the suppressed 200 response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { message: 'suppressed', suppressed: 1 }))
    const sd = makeClient(fetchMock)

    const result = await sd.send({ to: 'a@example.com', template_id: 't-1' })

    expect(result).toEqual({ message: 'suppressed', suppressed: 1 })
  })

  it('returns batch counters', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { sent: 2, failed: 0, suppressed: 1 }))
    const sd = makeClient(fetchMock)

    const result = await sd.sendBatch({
      template_id: 't-1',
      recipients: [{ to: 'a@example.com' }, { to: 'b@example.com', data: { name: 'B' } }],
    })

    expect(result).toEqual({ sent: 2, failed: 0, suppressed: 1 })
    const [url] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://mail.example.com/api/v1/projects/proj-1/send/batch')
  })

  it('sends broadcast with segment targeting', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { sent: 10, failed: 0 }))
    const sd = makeClient(fetchMock)

    await sd.broadcast({ template_id: 't-1', segment_id: 'seg-1' })

    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init.body)).toEqual({ template_id: 't-1', segment_id: 'seg-1' })
  })

  it('sends a newsletter broadcast and honours the per-newsletter unsubscribe', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { sent: 12, broadcast_id: 'b-9' }))
    const sd = makeClient(fetchMock)

    await sd.broadcast({ template_id: 't-1', newsletter_id: 'nl-3' })

    const [, init] = fetchMock.mock.calls[0]!
    expect(JSON.parse(init.body)).toEqual({ template_id: 't-1', newsletter_id: 'nl-3' })
  })

  it('imports subscribers as a bare array with validation flags', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        imported: 1,
        duplicates: 0,
        syntax_invalid: 0,
        no_mx: 0,
        disposable: 0,
        suppressed: 0,
        rejected: [],
      }),
    )
    const sd = makeClient(fetchMock)

    const result = await sd.importSubscribers([{ email: 'a@example.com', tags: ['beta'] }], {
      validate_mx: false,
    })

    expect(result.imported).toBe(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(
      'https://mail.example.com/api/v1/projects/proj-1/subscribers/import?validate_mx=false',
    )
    expect(JSON.parse(init.body)).toEqual([{ email: 'a@example.com', tags: ['beta'] }])
  })

  it('fetches stats with GET and no body', async () => {
    const stats = { total: 10, sent: 8, failed: 1, bounced: 1, suppressed: 0, opened: 5 }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, stats))
    const sd = makeClient(fetchMock)

    expect(await sd.stats()).toEqual(stats)
    const [, init] = fetchMock.mock.calls[0]!
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
  })

  it('throws SendDockError with the API message on 4xx', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: 'missing or invalid api key' }))
    const sd = makeClient(fetchMock)

    const err = await sd.stats().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(SendDockError)
    expect((err as SendDockError).status).toBe(401)
    expect((err as SendDockError).message).toBe('missing or invalid api key')
    expect((err as SendDockError).isAuthError).toBe(true)
  })

  it('retries on 429 honoring Retry-After, then succeeds', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse(429, { error: 'rate limit exceeded' }, { 'Retry-After': '1' }),
        )
        .mockResolvedValueOnce(jsonResponse(200, { message: 'sent' }))
      const sd = makeClient(fetchMock, 2)

      const pending = sd.send({ to: 'a@example.com', template_id: 't-1' })
      await vi.advanceTimersByTimeAsync(1000)

      expect(await pending).toEqual({ message: 'sent' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry on 400', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'invalid body' }))
    const sd = makeClient(fetchMock, 3)

    await expect(sd.send({ to: 'x', template_id: 't-1' })).rejects.toThrow('invalid body')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

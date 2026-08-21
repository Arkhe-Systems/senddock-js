import { SendDockError } from './error.js'
import type {
  BroadcastRequest,
  BroadcastResponse,
  ImportOptions,
  ImportResponse,
  ImportSubscriberRow,
  SendBatchRequest,
  SendBatchResponse,
  SendDockOptions,
  SendRequest,
  SendResponse,
  Stats,
} from './types.js'

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

export class SendDock {
  private readonly baseUrl: string
  private readonly apiKey: string
  private readonly projectId: string
  private readonly maxRetries: number
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof globalThis.fetch

  constructor(options: SendDockOptions) {
    if (!options.baseUrl) throw new Error('baseUrl is required, e.g. https://senddock.example.com')
    if (!options.apiKey) throw new Error('apiKey is required (a project API key, sk_...)')
    if (!options.projectId) throw new Error('projectId is required')
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.apiKey = options.apiKey
    this.projectId = options.projectId
    this.maxRetries = options.maxRetries ?? 2
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  send(request: SendRequest): Promise<SendResponse> {
    return this.request('POST', '/send', request)
  }

  sendBatch(request: SendBatchRequest): Promise<SendBatchResponse> {
    return this.request('POST', '/send/batch', request)
  }

  broadcast(request: BroadcastRequest): Promise<BroadcastResponse> {
    return this.request('POST', '/broadcast', request)
  }

  importSubscribers(rows: ImportSubscriberRow[], options?: ImportOptions): Promise<ImportResponse> {
    const params = new URLSearchParams()
    if (options?.validate_mx !== undefined) params.set('validate_mx', String(options.validate_mx))
    if (options?.validate_disposable !== undefined) {
      params.set('validate_disposable', String(options.validate_disposable))
    }
    const query = params.size > 0 ? `?${params}` : ''
    return this.request('POST', `/subscribers/import${query}`, rows)
  }

  stats(): Promise<Stats> {
    return this.request('GET', '/stats')
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/v1/projects/${this.projectId}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    }
    let payload: string | undefined
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }

    let lastError: SendDockError | undefined
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response: Response
      try {
        response = await this.fetchImpl(url, {
          method,
          headers,
          body: payload,
          signal: AbortSignal.timeout(this.timeoutMs),
        })
      } catch (cause) {
        lastError = networkError(cause, this.timeoutMs)
        if (attempt === this.maxRetries) throw lastError
        await sleep(500 * 2 ** attempt)
        continue
      }

      if (response.ok) {
        try {
          return (await response.json()) as T
        } catch (cause) {
          throw new SendDockError(
            response.status,
            'the server returned a non-JSON response body',
            cause,
          )
        }
      }

      const error = await this.toError(response)
      if (!RETRYABLE_STATUS.has(response.status) || attempt === this.maxRetries) {
        throw error
      }
      lastError = error
      await sleep(retryDelayMs(response, attempt))
    }
    throw lastError ?? new SendDockError(0, 'request failed')
  }

  private async toError(response: Response): Promise<SendDockError> {
    let message = `request failed with status ${response.status}`
    let body: unknown
    try {
      body = await response.json()
      const err = (body as { error?: unknown }).error
      if (typeof err === 'string' && err.length > 0) {
        message = err
      }
    } catch {
      body = undefined
    }
    return new SendDockError(response.status, message, body)
  }
}

function networkError(cause: unknown, timeoutMs: number): SendDockError {
  if (cause instanceof DOMException && cause.name === 'TimeoutError') {
    return new SendDockError(0, `request timed out after ${timeoutMs}ms`, cause)
  }
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new SendDockError(0, `network error: ${detail}`, cause)
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get('Retry-After'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter, 60) * 1000
  }
  return 500 * 2 ** attempt
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

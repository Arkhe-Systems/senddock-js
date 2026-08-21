export class SendDockError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'SendDockError'
    this.status = status
    this.body = body
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403
  }

  get isRateLimit(): boolean {
    return this.status === 429
  }

  get isNetworkError(): boolean {
    return this.status === 0
  }

  get isNotFound(): boolean {
    return this.status === 404
  }
}

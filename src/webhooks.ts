import { createHmac, timingSafeEqual } from 'node:crypto'

export interface VerifyWebhookOptions {
  payload: string | Uint8Array
  signature: string
  secret: string
  toleranceSeconds?: number
  now?: number
}

export function verifyWebhookSignature(options: VerifyWebhookOptions): boolean {
  const { payload, signature, secret, toleranceSeconds = 300 } = options
  const now = options.now ?? Math.floor(Date.now() / 1000)

  let timestamp: number | undefined
  let v1: string | undefined
  for (const part of signature.split(',')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === 't') timestamp = Number(value)
    if (key === 'v1') v1 = value
  }
  if (timestamp === undefined || !Number.isFinite(timestamp) || v1 === undefined) {
    return false
  }
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return false
  }

  const mac = createHmac('sha256', secret)
  mac.update(`${timestamp}.`)
  mac.update(payload)
  const expected = mac.digest()

  let received: Buffer
  try {
    received = Buffer.from(v1, 'hex')
  } catch {
    return false
  }
  if (received.length !== expected.length) {
    return false
  }
  return timingSafeEqual(expected, received)
}

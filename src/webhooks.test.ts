import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyWebhookSignature } from './webhooks.js'

function sign(payload: string, secret: string, timestamp: number): string {
  const mac = createHmac('sha256', secret)
  mac.update(`${timestamp}.`)
  mac.update(payload)
  return `t=${timestamp},v1=${mac.digest('hex')}`
}

describe('verifyWebhookSignature', () => {
  const secret = 'whsec_test'
  const payload = JSON.stringify({ id: 'evt_1', type: 'email.sent', data: {} })
  const now = 1_700_000_000

  it('accepts a valid signature', () => {
    const signature = sign(payload, secret, now)
    expect(verifyWebhookSignature({ payload, signature, secret, now })).toBe(true)
  })

  it('rejects a tampered payload', () => {
    const signature = sign(payload, secret, now)
    expect(
      verifyWebhookSignature({ payload: payload + 'x', signature, secret, now }),
    ).toBe(false)
  })

  it('rejects the wrong secret', () => {
    const signature = sign(payload, secret, now)
    expect(verifyWebhookSignature({ payload, signature, secret: 'other', now })).toBe(false)
  })

  it('rejects a stale timestamp beyond tolerance', () => {
    const signature = sign(payload, secret, now - 600)
    expect(verifyWebhookSignature({ payload, signature, secret, now })).toBe(false)
    expect(
      verifyWebhookSignature({ payload, signature, secret, now, toleranceSeconds: 700 }),
    ).toBe(true)
  })

  it('rejects malformed headers', () => {
    expect(verifyWebhookSignature({ payload, signature: 'garbage', secret, now })).toBe(false)
    expect(verifyWebhookSignature({ payload, signature: 't=abc,v1=00', secret, now })).toBe(false)
    expect(verifyWebhookSignature({ payload, signature: `t=${now}`, secret, now })).toBe(false)
  })
})

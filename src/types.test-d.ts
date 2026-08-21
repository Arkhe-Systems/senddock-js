import { describe, expectTypeOf, it } from 'vitest'
import { SendDock } from './client.js'
import type { ImportResponse, SendResponse, Stats } from './types.js'

declare const sd: SendDock

describe('compile-time contract', () => {
  it('accepts the three valid send shapes', () => {
    expectTypeOf(sd.send({ to: 'a@b.co', template_id: 't' })).resolves.toEqualTypeOf<SendResponse>()
    expectTypeOf(sd.send({ subscriber_id: 's', template_id: 't' })).resolves.toEqualTypeOf<SendResponse>()
    expectTypeOf(sd.send({ to: 'a@b.co', subject: 'x', html_body: '<p>x</p>' })).resolves.toEqualTypeOf<SendResponse>()
  })

  it('rejects invalid send bodies at compile time', () => {
    // @ts-expect-error a recipient alone is not a valid send shape
    void sd.send({ to: 'a@b.co' })
    // @ts-expect-error raw html requires a subject
    void sd.send({ to: 'a@b.co', html_body: '<p>x</p>' })
    // @ts-expect-error empty body is not a valid send shape
    void sd.send({})
  })

  it('rejects invalid batch and broadcast bodies at compile time', () => {
    // @ts-expect-error recipients is required
    void sd.sendBatch({ template_id: 't' })
    // @ts-expect-error recipients entries need a to address
    void sd.sendBatch({ template_id: 't', recipients: [{ data: {} }] })
    // @ts-expect-error template_id is required
    void sd.broadcast({ segment_id: 's' })
  })

  it('rejects invalid import rows at compile time', () => {
    // @ts-expect-error email is required on every row
    void sd.importSubscribers([{ name: 'Ada' }])
    // @ts-expect-error status is a closed union
    void sd.importSubscribers([{ email: 'a@b.co', status: 'banned' }])
  })

  it('types the responses precisely', () => {
    expectTypeOf(sd.stats()).resolves.toEqualTypeOf<Stats>()
    expectTypeOf(sd.importSubscribers([{ email: 'a@b.co' }])).resolves.toEqualTypeOf<ImportResponse>()
  })

  it('narrows the send response union on the suppressed discriminant', async () => {
    const result = await sd.send({ to: 'a@b.co', template_id: 't' })
    if ('message' in result && result.message === 'suppressed') {
      expectTypeOf(result.suppressed).toEqualTypeOf<number>()
    }
    if ('sent' in result) {
      expectTypeOf(result.sent).toEqualTypeOf<number>()
      expectTypeOf(result.suppressed).toEqualTypeOf<number | undefined>()
    }
  })
})

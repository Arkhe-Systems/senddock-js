# @senddock/sdk

The official TypeScript SDK for the [SendDock](https://senddock.dev) API — self-hosted email marketing, isolated by project.

Typed requests and responses, zero runtime dependencies, ESM + CJS, Node 18+.

```bash
npm install @senddock/sdk
```

## Quickstart

```ts
import { SendDock } from '@senddock/sdk'

const senddock = new SendDock({
  baseUrl: 'https://mail.yourcompany.com',
  projectId: 'your-project-id',
  apiKey: process.env.SENDDOCK_API_KEY!,
})

await senddock.send({
  to: 'ada@example.com',
  template_id: 'a3f0…',
  data: { name: 'Ada' },
})
```

Create an API key in the dashboard under **Project → Settings → API Keys**. Keys are project-scoped — the client always talks to the project the key belongs to. Keep them server-side.

## What you can do

Everything the project-scoped API allows:

### Send a transactional email

Three shapes, one method — a template to any address, a template to a stored subscriber, or raw HTML:

```ts
await senddock.send({ to: 'ada@example.com', template_id: 'tpl-id', data: { name: 'Ada' } })

await senddock.send({ subscriber_id: 'sub-id', template_id: 'tpl-id' })

await senddock.send({ to: 'ada@example.com', subject: 'Hi', html_body: '<h1>Hello</h1>' })
```

Recipients on the project's suppression list are skipped, not errored — the response is `{ message: 'suppressed', suppressed: 1 }` with a `200`.

### Send a batch

Up to 500 recipients per call, each with their own variables:

```ts
const result = await senddock.sendBatch({
  template_id: 'tpl-id',
  recipients: [
    { to: 'ada@example.com', data: { name: 'Ada' } },
    { to: 'alan@example.com', data: { name: 'Alan' } },
  ],
})
// { sent: 2, failed: 0, suppressed: 0 }
```

### Broadcast to your list

All active subscribers, or a saved segment:

```ts
await senddock.broadcast({ template_id: 'tpl-id' })

await senddock.broadcast({ template_id: 'tpl-id', segment_id: 'seg-id' })

await senddock.broadcast({ template_id: 'tpl-id', newsletter_id: 'nl-id' })
```

Broadcasts require the instance to have a public URL configured (recipients need a working unsubscribe link). A newsletter broadcast targets that publication's active members and gives each recipient a per-newsletter unsubscribe link — leaving the rest of the list and their project status untouched. `segment_id` and `newsletter_id` are mutually exclusive.

### Import subscribers

The server-side way to add subscribers — from one row to tens of thousands, with email validation:

```ts
const report = await senddock.importSubscribers(
  [{ email: 'ada@example.com', name: 'Ada', tags: ['beta'] }],
  { validate_mx: true },
)
// { imported: 1, duplicates: 0, syntax_invalid: 0, no_mx: 0, disposable: 0, suppressed: 0, rejected: [] }
```

### Project stats

```ts
const stats = await senddock.stats()
// { total, sent, failed, bounced, suppressed, opened }
```

## Verify incoming webhooks

SendDock signs outbound webhooks with `X-SendDock-Signature: t=<unix>,v1=<hmac>`. Verify against the **raw** request body, before any JSON parsing:

```ts
import { verifyWebhookSignature } from '@senddock/sdk'

app.post('/webhooks/senddock', express.raw({ type: 'application/json' }), (req, res) => {
  const valid = verifyWebhookSignature({
    payload: req.body,
    signature: req.get('X-SendDock-Signature') ?? '',
    secret: process.env.SENDDOCK_WEBHOOK_SECRET!,
  })
  if (!valid) return res.status(401).end()
  const event = JSON.parse(req.body)
  res.status(200).end()
})
```

The webhook secret is shown once, when you create the webhook in the dashboard.

## Errors and retries

Non-2xx responses throw a typed `SendDockError` carrying the API's message:

```ts
import { SendDockError } from '@senddock/sdk'

try {
  await senddock.send({ to: 'ada@example.com', template_id: 'tpl-id' })
} catch (err) {
  if (err instanceof SendDockError) {
    err.status      // 401, 404, 429, ...
    err.message     // the API's error string
    err.isRateLimit // convenience flags: isAuthError, isNotFound, isRateLimit
  }
}
```

The client retries `429` (honoring `Retry-After`) and `5xx` responses with exponential backoff, twice by default. Tune with `maxRetries` (set `0` to disable), or inject a custom `fetch`.

## API surface note

API keys intentionally cover the runtime surface: sending, importing subscribers, and stats. Configuration — templates, segments, webhooks, campaigns — is managed from the dashboard, where role-based permissions apply. See the [API reference](https://docs.senddock.dev/api/authentication) for the full picture.

## License

MIT

export interface SendDockOptions {
  baseUrl: string
  apiKey: string
  projectId: string
  maxRetries?: number
  timeoutMs?: number
  fetch?: typeof globalThis.fetch
}

export interface SendToEmail {
  to: string
  template_id: string
  subject?: string
  data?: Record<string, string>
  html_fields?: string[]
}

export interface SendToSubscriber {
  subscriber_id: string
  template_id: string
  subject?: string
  html_fields?: string[]
}

export interface SendRawHtml {
  to: string
  subject: string
  html_body: string
}

export type SendRequest = SendToEmail | SendToSubscriber | SendRawHtml

export type SendResponse =
  | { message: 'sent' }
  | { message: 'suppressed'; suppressed: number }
  | { sent: number; failed: number; suppressed?: number }

export interface BatchRecipient {
  to: string
  data?: Record<string, string>
}

export interface SendBatchRequest {
  template_id: string
  subject?: string
  recipients: BatchRecipient[]
  html_fields?: string[]
}

export interface SendBatchResponse {
  sent: number
  failed: number
  suppressed: number
}

export interface BroadcastRequest {
  template_id: string
  subject?: string
  variables?: Record<string, string>
  html_fields?: string[]
  /** Target a saved segment. Mutually exclusive with `newsletter_id`. */
  segment_id?: string
  /** Target a newsletter — recipients get a per-newsletter unsubscribe link. Mutually exclusive with `segment_id`. */
  newsletter_id?: string
}

export interface BroadcastResponse {
  sent: number
  /** The broadcast id, so you can poll `GET /broadcasts` for the final sent/failed/suppressed tallies. */
  broadcast_id?: string
}

export type SubscriberStatus = 'active' | 'pending' | 'unsubscribed'

export interface ImportSubscriberRow {
  email: string
  name?: string
  status?: SubscriberStatus
  fields?: Record<string, unknown>
  tags?: string[]
}

export interface ImportOptions {
  validate_mx?: boolean
  validate_disposable?: boolean
}

export type ImportRejectReason =
  | 'syntax_invalid'
  | 'no_mx'
  | 'disposable'
  | 'suppressed'
  | 'duplicate'

export interface ImportResponse {
  imported: number
  duplicates: number
  syntax_invalid: number
  no_mx: number
  disposable: number
  suppressed: number
  rejected: Array<{ email: string; name: string; reason: ImportRejectReason }>
}

export interface Stats {
  total: number
  sent: number
  failed: number
  bounced: number
  suppressed: number
  opened: number
}

export type WebhookEventType =
  | 'email.sent'
  | 'email.failed'
  | 'email.bounced'
  | 'email.opened'
  | 'email.clicked'
  | 'subscriber.created'
  | 'subscriber.unsubscribed'
  | 'subscriber.newsletter_unsubscribed'

export interface WebhookEvent<T = Record<string, unknown>> {
  id: string
  type: WebhookEventType
  created_at: string
  data: T
}

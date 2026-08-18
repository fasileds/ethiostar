import 'server-only'

/**
 * The `Mailer` port.
 *
 * M04's key control is that the notification log is evidentiary — "what EthioStar told a
 * customer and when". That record is written by the notification module inside the business
 * transaction; this port only carries bytes to a server afterwards.
 *
 * Two consequences shape the interface:
 *
 *  1. `send` returns a PROVIDER MESSAGE ID rather than void. Reconciling a bounce report
 *     against `notification.provider_message_id` is the only way to know a credential email
 *     actually arrived, and a customer who never received their password is a Stage 1 failure.
 *  2. A failure THROWS. The caller is the worker, which records the attempt and retries with
 *     backoff — swallowing it here would turn a dead SMTP host into silence.
 *
 * docs/adr/0007-domain-events-and-outbox.md
 */

export interface MailMessage {
  readonly to: string
  readonly subject: string
  /** Rendered body. Plain text; the adapter wraps it for the HTML part. */
  readonly body: string
  /** Set when the message belongs to a thread, e.g. a re-sent credential letter. */
  readonly replyTo?: string | undefined
  readonly attachments?: readonly MailAttachment[] | undefined
}

export interface MailAttachment {
  readonly filename: string
  readonly content: Buffer
  readonly contentType: string
}

export interface SentMail {
  /** The provider's id, stored against the notification for delivery reconciliation. */
  readonly providerMessageId: string
  readonly acceptedAt: Date
}

export interface Mailer {
  /** Deliver one message. Throws `InfrastructureError` on failure — the worker retries. */
  send(message: MailMessage): Promise<SentMail>
  /** Human-readable adapter name, for the delivery log and the admin health view. */
  readonly name: string
}

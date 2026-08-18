import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '@config/env'
import { InfrastructureError } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { systemClock } from '@core/clock/clock'
import type { Mailer, MailMessage, SentMail } from './mailer'

/**
 * SMTP delivery via nodemailer.
 *
 * The transport is created once and reused. Nodemailer pools connections, which matters
 * because the credential-issue burst at the start of a harvest season is dozens of messages
 * in a few seconds and a fresh TLS handshake each time is what makes that look like an outage.
 */

let transporter: Transporter | undefined

function transport(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
    pool: true,
    maxConnections: 3,
    // A hung SMTP server must not hold a worker slot indefinitely; the outbox will retry.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  return transporter
}

/**
 * Plain text → a minimal HTML part.
 *
 * Deliberately not a template engine. Every notification body is already rendered by M04
 * from a stored template; wrapping it in markup here would mean the bytes a customer saw and
 * the bytes in `rendered_body` are different, which defeats the evidentiary purpose.
 */
function toHtml(body: string): string {
  const escaped = body.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${escaped}</div>`
}

export class SmtpMailer implements Mailer {
  readonly name = 'smtp'

  async send(message: MailMessage): Promise<SentMail> {
    try {
      const info = await transport().sendMail({
        from: { name: env.MAIL_FROM_NAME, address: env.MAIL_FROM },
        to: message.to,
        subject: message.subject,
        text: message.body,
        html: toHtml(message.body),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(message.attachments
          ? {
              attachments: message.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                contentType: a.contentType,
              })),
            }
          : {}),
      })

      return {
        providerMessageId: info.messageId,
        acceptedAt: systemClock.now(),
      }
    } catch (error) {
      // Non-operational by construction: the customer did nothing wrong and can do nothing
      // about it. The worker records the attempt and dead-letters after max attempts.
      throw new InfrastructureError(ERROR_CODES.INTERNAL, {
        message: `SMTP delivery failed: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      })
    }
  }
}

/** Close the pooled transport on worker shutdown. */
export function closeMailer(): void {
  transporter?.close()
  transporter = undefined
}

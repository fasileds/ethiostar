import 'server-only'
import { logger } from '@core/logging/logger'
import { systemClock } from '@core/clock/clock'
import { uuidv7 } from '@core/ids/id-generator'
import type { Mailer, MailMessage, SentMail } from './mailer'

/**
 * Development delivery: log the message instead of sending it.
 *
 * Prints the FULL body, not a summary. The message most often exercised in development is
 * the credential letter, and a truncated log would hide the activation link that the
 * developer needs to complete a first login.
 *
 * `supabase start` also runs a mail catcher; this adapter exists for the case where the
 * developer is running against a remote database with no local SMTP at all.
 */
export class ConsoleMailer implements Mailer {
  readonly name = 'console'

  async send(message: MailMessage): Promise<SentMail> {
    logger.info(
      {
        mailer: this.name,
        to: message.to,
        subject: message.subject,
        body: message.body,
        attachments: message.attachments?.map((a) => a.filename) ?? [],
      },
      'email (not sent — console mailer)',
    )

    return { providerMessageId: `console:${uuidv7()}`, acceptedAt: systemClock.now() }
  }
}

/**
 * Test double. Captures messages for assertion and never performs I/O.
 *
 * Kept beside the real adapters rather than in a test folder so that a test importing it
 * cannot accidentally pick up the SMTP one by autocomplete.
 */
export class FakeMailer implements Mailer {
  readonly name = 'fake'
  readonly sent: MailMessage[] = []
  /** Set to make the next send throw, for exercising the retry path. */
  failNext = false

  async send(message: MailMessage): Promise<SentMail> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('FakeMailer: deliberate failure')
    }
    this.sent.push(message)
    return { providerMessageId: `fake:${this.sent.length}`, acceptedAt: systemClock.now() }
  }

  reset(): void {
    this.sent.length = 0
    this.failNext = false
  }
}

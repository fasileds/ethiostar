import 'server-only'
import { SmtpMailer } from './smtp-mailer'
import type { Mailer } from './mailer'

export type { Mailer, MailMessage, MailAttachment, SentMail } from './mailer'
export { SmtpMailer, closeMailer } from './smtp-mailer'
export { ConsoleMailer, FakeMailer } from './console-mailer'

let instance: Mailer | undefined

/**
 * The mailer this process should use.
 *
 * Always SMTP, in every environment. There is deliberately no `MAILER=console` switch: such
 * a flag left set in a production environment file would send every customer credential
 * email into a log file, and nothing about the system would look broken — the notification
 * row would still say SENT.
 *
 * Development points `SMTP_HOST` at the mail catcher `supabase start` runs on port 54325, so
 * this is a real send there too and the message is inspectable. A developer working without
 * a catcher injects `ConsoleMailer` through `__setMailer` explicitly.
 */
export function mailer(): Mailer {
  instance ??= new SmtpMailer()
  return instance
}

/** Test and local-development seam. Never called by application code. */
export function __setMailer(value: Mailer | undefined): void {
  instance = value
}

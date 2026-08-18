import 'server-only'
import type { Tx } from '@db/client'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { DEFAULT_LOCALE, type Locale } from '@config/constants'
import { uuidv7 } from '@core/ids/id-generator'
import { render, type TemplateVariables } from '../domain/template'
import {
  resolveTemplate,
  insertNotification,
  type Channel,
} from '../infrastructure/notification.repository'

/**
 * Queue one notification.
 *
 * Called with the caller's `tx`, so the queued message and the business change commit or
 * roll back together. A goods receipt that rolls back must not leave a customer holding an
 * email saying their coffee was received.
 *
 * SENDING happens later, in the worker. Nothing here performs I/O:
 * docs/architecture/06-cross-cutting.md §6.3 rule 3.
 */

export interface QueueNotificationInput {
  /** `notification_template.code`, e.g. `CUSTOMER_APPROVED`. */
  readonly templateCode: string
  readonly channel?: Channel
  readonly locale?: Locale
  /** Where it goes. At least one must be set — enforced by a check constraint too. */
  readonly recipientAddress?: string | null
  readonly recipientUserId?: string | null
  readonly recipientCustomerId?: string | null
  /** Substituted into the template; also persisted, so a render can be reproduced. */
  readonly variables: TemplateVariables
  readonly sourceType?: string | null
  readonly sourceId?: string | null
  readonly correlationId?: string | null
  readonly priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  /** The user whose action caused this. `null` for system-originated messages. */
  readonly actorId: string | null
}

export async function queueNotification(
  tx: Tx,
  input: QueueNotificationInput,
): Promise<string> {
  const channel = input.channel ?? 'EMAIL'
  const locale = input.locale ?? DEFAULT_LOCALE

  const template = await resolveTemplate(tx, input.templateCode, channel, locale)

  if (!template) {
    // Deliberately fatal to the enclosing operation rather than a silent skip. A missing
    // template is a deployment defect, and discovering it when a customer complains they
    // were never told is far more expensive than discovering it here.
    throw new BusinessRuleViolation(ERROR_CODES.NOTIFICATION_TEMPLATE_NOT_FOUND, {
      message: `No active ${channel} template "${input.templateCode}" for locale ${locale}.`,
      details: { templateCode: input.templateCode, channel, locale },
    })
  }

  const rendered = render(template, input.variables)

  return insertNotification(tx, {
    templateId: template.id,
    templateCode: template.code,
    channel,
    locale: template.locale,
    recipientUserId: input.recipientUserId ?? null,
    recipientCustomerId: input.recipientCustomerId ?? null,
    recipientAddress: input.recipientAddress ?? null,
    subject: rendered.subject,
    renderedBody: rendered.body,
    // The variables are kept beside the rendered text so a dispute about what a customer was
    // told can be settled from the row alone, without re-resolving master data.
    payload: { variables: input.variables, templateVersion: template.templateVersion },
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    // NOT NULL on `notification`. Most callers have no natural correlation id to hand — a
    // fresh one just gives this notification its own group of one, which is what "caused by
    // nothing else" should look like.
    correlationId: input.correlationId ?? uuidv7(),
    ...(input.priority ? { priority: input.priority } : {}),
    actorId: input.actorId,
  })
}

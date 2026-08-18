import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { queueNotification, type QueueNotificationInput } from './queue-notification'

/**
 * Queue a notification on behalf of a DEFERRED event subscriber.
 *
 * Deferred handlers run from the outbox with AT-LEAST-ONCE delivery
 * (`server/events/registry.ts`), so every one of them must be idempotent. This is the
 * shared idempotency check: before queuing, look for a notification already queued for
 * this exact (event, template) pair. If the relay retries after a crash between "insert
 * notification" and "mark outbox published", the second attempt is a no-op instead of a
 * second credential email.
 *
 * `sourceType: 'domain_event'` / `sourceId: eventId` is the dedup key. It costs nothing
 * extra: `notification.source_type`/`source_id` already exist for the "what caused this"
 * question the delivery log needs answered anyway.
 */
export async function queueNotificationForEvent(
  tx: Tx,
  eventId: string,
  input: Omit<QueueNotificationInput, 'sourceType' | 'sourceId'>,
): Promise<string> {
  const existing = await rawRows(
    tx,
    sql`
      select id from public.notification
      where source_type = 'domain_event'
        and source_id = ${eventId}::uuid
        and template_code = ${input.templateCode}
      limit 1
    `,
  )

  const found = existing[0]
  if (found) return col.text(found.id)

  return queueNotification(tx, {
    ...input,
    sourceType: 'domain_event',
    sourceId: eventId,
  })
}

import { sql } from 'drizzle-orm'
import { withServiceDb, type Tx } from '@db/client'
import { SYSTEM_ACTOR_ID } from '@modules/identity'
import { claimOutboxBatch, markPublished, markFailed } from '@modules/audit'
import { deferredHandlersFor } from '@server/events/registry'
import type { DomainEventEnvelope } from '@core/domain/domain-event'
import type { JobContext } from './types'

/**
 * The outbox relay.
 *
 * Drains `outbox` rows written transactionally with their business change, and dispatches
 * each to the deferred subscribers registered for that event name.
 *
 * Delivery is AT-LEAST-ONCE. If a handler succeeds but the relay crashes before marking the
 * row published, it runs again — which is why every deferred handler must be idempotent.
 *
 * docs/adr/0007-domain-events-and-outbox.md
 */

const RELAY_BATCH_SIZE = 50
const MAX_ATTEMPTS = 5

interface EventRow {
  id: string
  name: string
  version: string
  occurred_at: Date
  aggregate_type: string
  aggregate_id: string
  actor_id: string | null
  correlation_id: string
  causation_id: string | null
  payload: Record<string, unknown>
}

async function loadEvent(tx: Tx, eventId: string): Promise<EventRow | undefined> {
  const result = await tx.execute(sql`
    select id, name, version, occurred_at, aggregate_type, aggregate_id,
           actor_id, correlation_id, causation_id, payload
    from public.domain_event
    where id = ${eventId}
  `)
  return (result as unknown as EventRow[])[0]
}

function toEnvelope(row: EventRow): DomainEventEnvelope {
  return {
    eventId: row.id,
    name: row.name,
    version: Number(row.version),
    occurredAt: row.occurred_at,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    payload: row.payload,
  }
}

export async function relayOutbox(ctx: JobContext): Promise<void> {
  const claimed = await withServiceDb(SYSTEM_ACTOR_ID, 'outbox:claim', (tx: Tx) =>
    claimOutboxBatch(tx, RELAY_BATCH_SIZE),
  )

  if (claimed.length === 0) return

  ctx.log.debug({ count: claimed.length }, 'relaying outbox batch')

  for (const item of claimed) {
    const handlers = deferredHandlersFor(item.eventName)

    // No subscriber is not a failure — many events exist purely as the historical record
    // that Phase 2 billing and Phase 3 forecasting will read.
    if (handlers.length === 0) {
      await withServiceDb(SYSTEM_ACTOR_ID, 'outbox:publish', (tx: Tx) =>
        markPublished(tx, item.outboxId),
      )
      continue
    }

    try {
      const row = await withServiceDb(SYSTEM_ACTOR_ID, 'outbox:load', (tx: Tx) =>
        loadEvent(tx, item.eventId),
      )

      if (!row) {
        throw new Error(`domain_event ${item.eventId} not found`)
      }

      const envelope = toEnvelope(row)

      // Sequential: a handler that depends on an earlier one having run should be inline,
      // but ordering within a single event's fan-out is still predictable this way.
      for (const registration of handlers) {
        await registration.handler(envelope)
      }

      await withServiceDb(SYSTEM_ACTOR_ID, 'outbox:publish', (tx: Tx) =>
        markPublished(tx, item.outboxId),
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      const outcome = await withServiceDb(SYSTEM_ACTOR_ID, 'outbox:fail', (tx: Tx) =>
        markFailed(tx, item.outboxId, message, item.attempts, MAX_ATTEMPTS),
      )

      if (outcome === 'DEAD') {
        // A dead-lettered event is a side effect the business expected and did not get —
        // a customer who was never told their appointment moved.
        ctx.log.error(
          { eventId: item.eventId, eventName: item.eventName, err: message },
          'outbox event dead-lettered',
        )
      } else {
        ctx.log.warn(
          { eventId: item.eventId, eventName: item.eventName, err: message },
          'outbox event failed — will retry',
        )
      }
    }
  }
}

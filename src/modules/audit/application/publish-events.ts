import 'server-only'
import type { Tx } from '@db/client'
import type { DomainEventEnvelope, PendingDomainEvent } from '@core/domain/domain-event'
import { appendEvents, type AppendOptions } from '../infrastructure/event-store'
import { inlineHandlersFor } from '../infrastructure/event-registry'

/**
 * The event bus. Every use case that emits domain events calls THIS, not `appendEvents`
 * directly — `appendEvents` only writes `domain_event` and `outbox`; this also dispatches
 * to INLINE subscribers, in the same transaction, immediately.
 *
 * DEFERRED subscribers are not run here — they are looked up and invoked by the outbox
 * relay after commit (`worker/handlers/relay-outbox.handler.ts`). This function only ever
 * touches the inline half.
 *
 * docs/architecture/01-principles-and-layering.md §1.3
 */
export async function publishEvents(
  tx: Tx,
  events: readonly PendingDomainEvent[],
  options: AppendOptions,
): Promise<string[]> {
  const ids = await appendEvents(tx, events, options)

  for (const [index, event] of events.entries()) {
    const eventId = ids[index]
    if (!eventId) continue

    const envelope: DomainEventEnvelope = {
      eventId,
      name: event.name,
      version: event.version,
      occurredAt: event.occurredAt,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      actorId: event.actorId,
      correlationId: options.correlationId,
      causationId: event.causationId ?? options.causationId ?? null,
      payload: event.payload,
    }

    for (const registration of inlineHandlersFor(event.name)) {
      // Sequential and unguarded: an inline handler that throws is meant to roll back the
      // whole transaction along with the business change it could not keep up with.
      await registration.handler(envelope, tx)
    }
  }

  return ids
}

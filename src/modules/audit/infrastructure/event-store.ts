import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { domainEvent, outbox } from '@db/schema'
import type { PendingDomainEvent } from '@core/domain/domain-event'
import { uuidv7 } from '@core/ids/id-generator'

/**
 * The transactional outbox.
 *
 * Writing to the database and publishing an event are one atomic act, or the system lies.
 * Both rows go in with the business change:
 *
 *   domain_event  the permanent, append-only record — audit (M07), the substrate Phase 2
 *                 billing prices, and the history Phase 3 learns from.
 *   outbox        the delivery queue for side effects, drained by the worker after commit.
 *
 * If a crash happens between commit and publish, the outbox row is still there and the
 * relay picks it up. Publishing after commit without an outbox loses events — and in this
 * system a lost event is a customer who was never told their appointment moved.
 *
 * docs/adr/0007-domain-events-and-outbox.md
 */

/** Events whose only consumers are in-process; no outbox row, no worker involvement. */
const NO_SIDE_EFFECTS = new Set<string>([])

export interface AppendOptions {
  /** Groups every event and movement of one business operation. */
  readonly correlationId: string
  /** The event that caused these, for tracing a chain of effects. */
  readonly causationId?: string | null
}

/**
 * Append events INSIDE the caller's transaction. Never call this outside one — the
 * atomicity is the entire point.
 *
 * Returns the persisted event ids so a caller can use one as the causationId of a
 * follow-on event.
 */
export async function appendEvents(
  tx: Tx,
  events: readonly PendingDomainEvent[],
  options: AppendOptions,
): Promise<string[]> {
  if (events.length === 0) return []

  const rows = events.map((event) => ({
    id: uuidv7(),
    name: event.name,
    version: String(event.version),
    occurredAt: event.occurredAt,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    actorId: event.actorId,
    correlationId: options.correlationId,
    causationId: event.causationId ?? options.causationId ?? null,
    payload: event.payload as Record<string, unknown>,
  }))

  await tx.insert(domainEvent).values(rows)

  const outboxRows = rows
    .filter((row) => !NO_SIDE_EFFECTS.has(row.name))
    .map((row) => ({
      id: uuidv7(),
      eventId: row.id,
      eventName: row.name,
      status: 'PENDING',
    }))

  if (outboxRows.length > 0) {
    await tx.insert(outbox).values(outboxRows)
  }

  return rows.map((row) => row.id)
}

/**
 * Claim a batch of outbox rows for publication.
 *
 * `FOR UPDATE SKIP LOCKED` is what makes running several worker instances safe with no
 * coordination service: each claims a disjoint set, and a slow handler blocks nobody.
 */
export async function claimOutboxBatch(
  tx: Tx,
  batchSize: number,
): Promise<Array<{ outboxId: string; eventId: string; eventName: string; attempts: number }>> {
  const result = await tx.execute(sql`
    update public.outbox o
    set status = 'CLAIMED'
    where o.id in (
      select id from public.outbox
      where status = 'PENDING'
        and next_attempt_at <= now()
      order by created_at
      for update skip locked
      limit ${batchSize}
    )
    returning o.id as outbox_id, o.event_id, o.event_name, o.attempts
  `)

  const rows = result as unknown as Array<{
    outbox_id: string
    event_id: string
    event_name: string
    attempts: string
  }>

  return rows.map((row) => ({
    outboxId: row.outbox_id,
    eventId: row.event_id,
    eventName: row.event_name,
    attempts: Number(row.attempts),
  }))
}

export async function markPublished(tx: Tx, outboxId: string): Promise<void> {
  await tx.execute(sql`
    update public.outbox
    set status = 'PUBLISHED', published_at = now()
    where id = ${outboxId}
  `)
}

/**
 * Record a failure and schedule a retry with exponential backoff plus full jitter.
 * After `max_attempts` the row moves to DEAD and raises an alert rather than disappearing.
 */
export async function markFailed(
  tx: Tx,
  outboxId: string,
  error: string,
  attempts: number,
  maxAttempts: number,
): Promise<'RETRY' | 'DEAD'> {
  const exhausted = attempts + 1 >= maxAttempts

  if (exhausted) {
    await tx.execute(sql`
      update public.outbox
      set status = 'DEAD', attempts = ${String(attempts + 1)}, last_error = ${error}
      where id = ${outboxId}
    `)
    return 'DEAD'
  }

  // Full jitter: synchronised retries turn a transient spike into an outage.
  const baseSeconds = Math.min(2 ** (attempts + 1), 300)
  const delaySeconds = Math.floor(Math.random() * baseSeconds) + 1

  await tx.execute(sql`
    update public.outbox
    set status = 'PENDING',
        attempts = ${String(attempts + 1)},
        last_error = ${error},
        next_attempt_at = now() + make_interval(secs => ${delaySeconds})
    where id = ${outboxId}
  `)
  return 'RETRY'
}

/** Outbox lag in seconds — the earliest signal that customers stopped being notified. */
export async function outboxLagSeconds(tx: Tx): Promise<number> {
  const result = await tx.execute(sql`
    select coalesce(extract(epoch from now() - min(created_at)), 0)::float8 as lag
    from public.outbox
    where published_at is null and status <> 'DEAD'
  `)
  const rows = result as unknown as Array<{ lag: number }>
  return rows[0]?.lag ?? 0
}

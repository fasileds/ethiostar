/**
 * Domain events — the integration mechanism between modules, the audit substrate, and the
 * reason Phase 2 billing and Phase 3 AI can be added without re-instrumenting Phase 1.
 *
 * History not captured during Phase 1 does not exist in Phase 2 or 3 and cannot be
 * reconstructed. See docs/adr/0007-domain-events-and-outbox.md.
 *
 * Events are VERSIONED from the first one written. Adding `version: 1` now costs nothing;
 * retrofitting it onto a production event store costs a migration and a compatibility shim.
 */

export interface DomainEventEnvelope<
  TName extends string = string,
  TPayload = Readonly<Record<string, unknown>>,
> {
  readonly eventId: string
  readonly name: TName
  readonly version: number
  /** When it happened in the world. */
  readonly occurredAt: Date
  readonly aggregateType: string
  readonly aggregateId: string
  /** The named user responsible. `null` only for system actors (the worker). */
  readonly actorId: string | null
  /** Groups every event and movement of one business operation. */
  readonly correlationId: string
  /** The event that caused this one, for tracing a chain of effects. */
  readonly causationId: string | null
  readonly payload: TPayload
}

/** What an aggregate emits; the envelope fields are filled in when it is appended. */
export interface PendingDomainEvent<
  TName extends string = string,
  TPayload = Readonly<Record<string, unknown>>,
> {
  readonly name: TName
  readonly version: number
  readonly occurredAt: Date
  readonly aggregateType: string
  readonly aggregateId: string
  readonly actorId: string | null
  readonly payload: TPayload
  readonly causationId?: string | null
}

/**
 * Helper for declaring a typed event factory in a module's `domain/events.ts`.
 *
 *   export const consignmentReceived = defineEvent<'ConsignmentReceived', {...}>(
 *     'ConsignmentReceived', 1, 'Consignment',
 *   )
 */
export function defineEvent<TName extends string, TPayload>(
  name: TName,
  version: number,
  aggregateType: string,
) {
  return (args: {
    aggregateId: string
    actorId: string | null
    occurredAt: Date
    payload: TPayload
    causationId?: string | null
  }): PendingDomainEvent<TName, TPayload> => ({
    name,
    version,
    aggregateType,
    aggregateId: args.aggregateId,
    actorId: args.actorId,
    occurredAt: args.occurredAt,
    payload: args.payload,
    ...(args.causationId !== undefined ? { causationId: args.causationId } : {}),
  })
}

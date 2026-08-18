import type { PendingDomainEvent } from './domain-event'

/**
 * Identity-based equality. Two entities are the same entity when their ids match,
 * regardless of field values.
 */
export abstract class Entity<TId extends string> {
  protected constructor(readonly id: TId) {}

  equals(other: Entity<TId> | null | undefined): boolean {
    if (!other) return false
    if (this === other) return true
    return this.constructor === other.constructor && this.id === other.id
  }
}

/**
 * An aggregate root: the consistency boundary. Everything inside it is updated in one
 * transaction and its invariants always hold.
 *
 * Carries two things beyond a plain entity:
 *   • an event buffer — events are drained by the use case and appended in the SAME
 *     transaction as the state change, which is what makes the audit trail trustworthy;
 *   • a version — optimistic concurrency, so two store keepers editing one GRN produces a
 *     clear "someone else changed this" rather than a lost update.
 */
export abstract class AggregateRoot<TId extends string> extends Entity<TId> {
  private pendingEvents: PendingDomainEvent[] = []

  protected constructor(
    id: TId,
    /** Row version as loaded. Incremented by the repository on a successful write. */
    readonly version: number = 0,
  ) {
    super(id)
  }

  protected raise(event: PendingDomainEvent): void {
    this.pendingEvents.push(event)
  }

  /** Drain the buffer. Called exactly once, by the use case, inside the transaction. */
  pullEvents(): PendingDomainEvent[] {
    const events = this.pendingEvents
    this.pendingEvents = []
    return events
  }

  /** Inspect without draining — for assertions in tests. */
  peekEvents(): readonly PendingDomainEvent[] {
    return this.pendingEvents
  }

  hasPendingEvents(): boolean {
    return this.pendingEvents.length > 0
  }
}

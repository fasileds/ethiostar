import { pgTable, text, uuid, jsonb, index, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { instant } from '../helpers/columns'

/**
 * M07 — Audit Trail, Compliance & Traceability.
 *
 * Two complementary append-only records, both written in the SAME transaction as the
 * business change. That atomicity is what makes the audit trail trustworthy: the record
 * and the change cannot diverge.
 *
 *   audit_log     generic row-level before/after capture, written by fn_audit_row().
 *                 Catches everything, including paths someone forgot to instrument.
 *   domain_event  semantic business events with typed payloads. Meaningful to a human,
 *                 and the substrate Phase 2 billing and Phase 3 AI are built on.
 *   outbox        delivery queue for side effects. At-least-once; handlers are idempotent.
 *
 * All three are append-only, enforced by fn_block_mutation() plus REVOKE — not by
 * convention. See docs/adr/0007-domain-events-and-outbox.md.
 */

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    /** INSERT | UPDATE | DELETE */
    operation: text('operation').notNull(),
    /** On UPDATE: { field: { from, to } } for the changed fields only. */
    changedFields: jsonb('changed_fields'),
    oldValues: jsonb('old_values'),
    newValues: jsonb('new_values'),
    actorId: uuid('actor_id').notNull(),
    occurredAt: instant('occurred_at')
      .notNull()
      .default(sql`now()`),
    requestId: text('request_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('idx_audit_log__entity').on(t.entityType, t.entityId, t.occurredAt.desc()),
    index('idx_audit_log__actor').on(t.actorId, t.occurredAt.desc()),
    index('idx_audit_log__occurred').on(t.occurredAt.desc()),
    check('ck_audit_log__operation', sql`${t.operation} in ('INSERT','UPDATE','DELETE')`),
  ],
)

export const domainEvent = pgTable(
  'domain_event',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    /**
     * Versioned from the FIRST event written. Retrofitting a version onto a production
     * event store costs a migration and a compatibility shim; adding it now costs nothing.
     */
    version: text('version').notNull().default('1'),
    occurredAt: instant('occurred_at').notNull(),
    recordedAt: instant('recorded_at')
      .notNull()
      .default(sql`now()`),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    /** Null only for system actors (the worker). */
    actorId: uuid('actor_id'),
    /** Groups every event and movement of one business operation. */
    correlationId: uuid('correlation_id').notNull(),
    /** The event that caused this one — traces a chain of effects. */
    causationId: uuid('causation_id'),
    payload: jsonb('payload').notNull(),
  },
  (t) => [
    index('idx_domain_event__aggregate').on(t.aggregateType, t.aggregateId, t.occurredAt),
    index('idx_domain_event__name').on(t.name, t.occurredAt.desc()),
    index('idx_domain_event__correlation').on(t.correlationId),
    index('idx_domain_event__occurred').on(t.occurredAt.desc()),
  ],
)

export const outbox = pgTable(
  'outbox',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => domainEvent.id),
    eventName: text('event_name').notNull(),
    status: text('status').notNull().default('PENDING'),
    attempts: text('attempts').notNull().default('0'),
    maxAttempts: text('max_attempts').notNull().default('5'),
    nextAttemptAt: instant('next_attempt_at')
      .notNull()
      .default(sql`now()`),
    publishedAt: instant('published_at'),
    lastError: text('last_error'),
    createdAt: instant('created_at')
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    // Partial index: the pending set stays small forever while the table grows without
    // bound, so the index stays tiny and hot.
    index('idx_outbox__unpublished')
      .on(t.nextAttemptAt)
      .where(sql`${t.publishedAt} is null`),
    index('idx_outbox__event').on(t.eventId),
    check(
      'ck_outbox__status',
      sql`${t.status} in ('PENDING','CLAIMED','PUBLISHED','FAILED','DEAD')`,
    ),
  ],
)

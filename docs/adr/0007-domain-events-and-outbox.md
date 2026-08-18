# 0007 — Domain events with a transactional outbox

**Status:** Accepted · 2026-08-12

## Context

Three requirements converge on the same mechanism:

1. **M07** needs a permanent record of everything that happened, with the business change.
2. **Module decoupling** — receiving must not import notification, or the dependency graph inverts.
3. **Phases 2 and 3** are built on accumulated history. M19 must price activity that occurred before
   it shipped; M26/M27 need history to learn from. History not captured in Phase 1 does not exist
   later.

Writing to the database and sending an email are not one atomic act. Doing them naively means either
an email about a transaction that rolled back, or a committed transaction with no notification.

## Decision

- Aggregates buffer domain events; the use case appends them to `domain_event` (append-only,
  versioned envelopes) **in the same transaction** as the business change, along with an `outbox`
  row.
- A relay in the worker claims outbox rows with `FOR UPDATE SKIP LOCKED` and dispatches to
  subscribers. Delivery is **at-least-once**; handlers must be idempotent.
- Handlers that must be atomic with the change (lifecycle transition, stock ledger) run inline in the
  transaction, not through the outbox.
- Events carry `eventId`, `name`, `version`, `occurredAt`, `actorId`, `correlationId`, `causationId`,
  `aggregateType`, `aggregateId`, `payload` — versioned from the first event written.

## Consequences

**Positive**

- The audit record and the business change cannot diverge. This is the evidential property M07 needs.
- Modules stay decoupled without a message broker.
- Phase 2 billing can backfill charges for Phase 1 history by replaying the stream.
- `correlationId` gives Phase 3 the record-level traceability its governance rules demand.

**Negative**

- Eventual consistency for side effects: a notification may lag the transaction by seconds. Correct
  for email; anything requiring immediacy runs inline.
- Handlers must be idempotent, which is a real discipline and must be tested.
- Event payloads become a contract. Versioning from day one is what makes changing them survivable.

## Alternatives rejected

- **Direct calls between modules.** Inverts the dependency graph and makes Phase 2 subscription a
  code change in every emitting module.
- **A message broker (Kafka/RabbitMQ).** An extra component to run and back up, for a workload one
  Postgres table handles comfortably. The `Queue` port allows the swap if volume ever justifies it.
- **Publishing after commit, without an outbox.** Loses events on a crash between commit and publish.
  In this system a lost event is a customer who was never told their appointment moved.

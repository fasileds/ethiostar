# 0008 — Postgres-backed queue and a separate worker process

**Status:** Accepted · 2026-08-12 · **amended by [0013](0013-supabase-as-database-platform.md)**

> **Amendment (Supabase).** Decision unchanged — the queue table and the Node worker are retained,
> now against Supabase Postgres. Two Supabase-specific rulings:
>
> - **`pg_cron` replaces our leader-election tick** for recurring schedules. It is a scheduler, not a
>   job runner: a cron entry only inserts a `job_queue` row, and the worker still executes it. This
>   removes the advisory-lock leader election with no loss of retry, backoff or dead-lettering.
>   Requires a Pro plan on hosted Supabase; the advisory-lock tick remains the fallback.
> - **Edge Functions are not used.** Fragmenting work across Deno and Node, with a second deployment
>   model and no shared domain layer, buys nothing our worker does not already do durably.
>
> The worker connects with `service_role` — one of the three sanctioned uses in
> [0013](0013-supabase-as-database-platform.md) — because it acts with no user context. Every job
> that writes still sets `app.actor_id` so the audit trigger attributes it to a system actor.

## Context

Phase 1 needs durable background work: notification delivery with retry, PDF rendering outside
business transactions, document-expiry scans, capacity-threshold alerts, ageing-stock alerts,
reservation expiry, session cleanup and ledger reconciliation.

M04's key control makes the notification log an evidentiary record, which means delivery must be
durable and its attempts recorded — not best-effort.

## Decision

- A `job_queue` table in the same Postgres database, claimed with `FOR UPDATE SKIP LOCKED`.
- A **separate worker process** from the same container image, different entrypoint.
- Exponential backoff with jitter, `max_attempts`, dead-letter table, idempotency keys for
  enqueue-once semantics.
- Recurring schedules guarded by a leader-election advisory lock so multiple instances do not
  double-enqueue.
- Graceful shutdown: SIGTERM → stop claiming → finish in-flight → exit.

## Consequences

**Positive**

- Enqueue is transactional with the business write — the same property as the outbox, for the same
  reason.
- No Redis, no broker: one database to back up, restore and monitor.
- `SKIP LOCKED` makes horizontal scaling of workers free and coordination-free.
- Failed work is visible in a table an operator can query, rather than lost in a log.

**Negative**

- Queue load competes with application load on the same database. At plant scale this is
  comfortable; if it ever is not, the `Queue` port allows a swap.
- Polling adds a small constant load. Tune the interval; use `LISTEN/NOTIFY` to wake the poller early
  if latency ever matters.
- A second process to deploy and monitor. Unavoidable for durable work, and the alternative is worse.

## Alternatives rejected

- **`after()` from `next/server`.** Correct for fire-and-forget logging; wrong here — it is
  best-effort and dies with the request, so a crash loses a notification the business must prove it
  sent.
- **Cron hitting an HTTP endpoint.** No retry semantics, no visibility, no concurrency control, and
  the endpoint is an attack surface.
- **BullMQ + Redis.** Mature and capable, but adds a component to operate and breaks transactional
  enqueue.
- **pg-boss.** Essentially this design as a library, and a reasonable substitute. Rejected only
  because the in-house version is ~200 lines, avoids a dependency on its schema conventions, and the
  team needs to understand this machinery anyway. Adopting it later is contained by the `Queue` port.

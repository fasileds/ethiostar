# 0005 — Row-Level Security in addition to, not instead of, application scoping

**Status:** Accepted · 2026-08-12 · **amended by [0013](0013-supabase-as-database-platform.md)**

> **Amendment (Supabase).** The decision is unchanged and is now stronger, because Supabase makes RLS
> native. Two mechanics change:
>
> - Identity comes from `auth.uid()` / `auth.jwt()`, not from a bespoke `app.customer_id` setting.
>   The application reproduces PostgREST's context per transaction:
>   `set_config('request.jwt.claims', …, true)` + `set local role authenticated`.
> - **New primary risk: `service_role` bypasses RLS entirely.** The structural rule confining it to
>   migrations, the worker and one audited `system` namespace is in
>   [0013](0013-supabase-as-database-platform.md) and is now the load-bearing control.
>
> `set_config(..., true)` remains transaction-scoped for the same reason as before — Supavisor's
> transaction pooling reuses connections across requests.

## Context

M09's key control: _"A customer sees only their own data, enforced at the data layer."_ The document
says data layer specifically. In practice a customer-scoping bug is one forgotten `WHERE` clause, and
that clause is forgotten in the query written at 6 p.m. on a Friday, not in the one that was
reviewed.

## Decision

Both mechanisms, always:

1. **Application scoping** — every repository read takes the actor's scope and applies the predicate,
   via a shared `applyScope(qb, actor)` helper. This is the primary mechanism and produces good query
   plans.
2. **Postgres RLS** — policies on every customer-scoped table, with the actor identity supplied by
   `set_config('app.customer_id', $1, true)` at the start of each transaction. This is the backstop.

The application connects as `authenticated`, which is **not** the table owner (owners bypass RLS).
Migrations run as `postgres` via the Supabase CLI. `FORCE ROW LEVEL SECURITY` is set so the policy
applies even to the table owner.

## Consequences

**Positive**

- A forgotten filter leaks nothing. That is the entire point.
- The control is verifiable to an auditor as a database policy, not as a claim about code.
- Cheap: one `set_config` per transaction.

**Negative**

- **The transaction-scoped flag is critical.** `set_config(..., false)` under Supavisor transaction
  pooling leaks one request's identity into the next request on the same connection. This is the
  single most dangerous detail in the data layer, and it is covered by a dedicated interleaved-
  transaction integration test.
- RLS predicates can affect query plans on large tables. Monitored; the application-level filter
  usually makes the RLS predicate redundant to the planner.
- Every new customer-scoped table needs a policy. Enforced by a CI check that lists tables with a
  `customer_id` column and no policy.

## Alternatives rejected

- **Application scoping only.** One missed filter is a breach. The document's wording asks for more.
- **RLS only.** Poorer query plans, harder to express staff scope rules (branch/warehouse/room), and
  a policy bug is equally silent. Defence in depth means both.
- **Separate database per customer.** Absurd at this scale, and makes cross-customer operational
  reporting impossible.

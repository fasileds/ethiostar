# 0003 — Append-only stock ledger, and a consignment spine module

**Status:** Accepted · 2026-08-12

## Context

The client document's module catalogue (M11–M17) is a _delivery_ breakdown. Taken literally as a code
structure it produces two failures:

1. Each operational module keeps its own notion of "how much is in stock", and they drift.
2. The consignment lifecycle is implemented six times, and one of them permits a skipped state.

Separately: the business is custody of a third party's asset. _"a few kilograms of discrepancy is a
commercial dispute."_

## Decision

Two structural choices:

**A. A `consignment` module below M11–M17** owning the `Consignment` and `Lot` aggregates, the
lifecycle state machine and lot lineage. Operational modules transition the consignment through it;
none of them writes `consignment.status` directly.

**B. A `stock` module whose source of truth is an append-only ledger** (`stock_movement`), with
`stock_balance` as a projection maintained in the same transaction. A mutable "current quantity"
column as a source of truth is prohibited.

## Consequences

**Positive**

- Any figure can be explained by replaying its movements. This is the difference between winning and
  losing a dispute.
- Mass balance becomes a ledger property: the signed sum over a job's correlation id is zero. One
  invariant, testable with property-based tests.
- The projection can be dropped and rebuilt from the ledger; the reverse is impossible. That
  asymmetry is the whole argument.
- The physical-count variance report is computable honestly, because expected and counted are
  independently derived.
- The lifecycle exists in one place with one exhaustive test.

**Negative**

- More rows: a transfer is two rows, a job is six or more. Storage is cheap; partition monthly from
  day one (roadmap Step 16).
- Every write path must go through `stock.postMovements` — enforced by lint plus code review, since
  a direct balance update would silently break the invariant.
- The projection upsert takes a row lock, serialising concurrent movements on the same lot and
  location. This is correct behaviour, not a bug, and it is not a bottleneck at plant scale.

## Alternatives rejected

- **Mutable quantity column.** See [../architecture/10-risks-and-antipatterns.md](../architecture/10-risks-and-antipatterns.md) A1.
- **Full event sourcing.** Would give the same auditability plus replay, at a large complexity cost
  in projections, versioning and tooling. State-plus-ledger-plus-event-log captures the benefit that
  matters here at a fraction of the cost.
- **Ledger without a projection.** Summing on read degrades linearly through a season; the portal
  stock page is the hottest query in the system.

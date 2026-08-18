# 0001 — Modular monolith over microservices

**Status:** Accepted · 2026-08-12

## Context

28 modules across six layers, three delivery phases, one plant, a small team, and a business whose
core value is a consistent custody record. Weight, stock, capacity, bag counts and audit entries
must move together or the record is not defensible in a dispute.

## Decision

One deployable Next.js application plus one background worker, internally partitioned into feature
modules with **machine-enforced** dependency rules (`eslint-plugin-boundaries`,
`dependency-cruiser`) and a declared tier ordering.

## Consequences

**Positive**

- Cross-module writes are one database transaction. The audit event and the business change cannot
  diverge, which is the property the whole system exists to provide.
- One deployment, one database to back up, one place to look during an incident. Appropriate to
  EthioStar's operational capacity.
- Any module can be extracted later _because_ the boundaries are enforced — the refactoring cost is
  paid only if it is ever needed.

**Negative**

- A single module's failure can affect the process. Mitigated by error boundaries per route group
  and by the worker being a separate process.
- Scaling is coarse-grained: the whole app scales together. At this workload that is irrelevant.
- Boundary discipline depends on tooling that must be configured before the first module (roadmap
  Step 1) — added late, it is a week of untangling.

## Alternatives rejected

- **Microservices.** Buys deployment independence the team does not need, at the cost of distributed
  transactions across exactly the data that must be consistent. Wrong trade for a custody business.
- **Unstructured Next.js app.** Would not survive 28 modules, 12 roles and an evidential audit
  requirement. Produces the 2000-line route file this plan exists to prevent.
- **Separate backend service (NestJS) + Next frontend.** Defensible, and adds a network hop, a second
  deployment, duplicated types and duplicated auth for no benefit at this size. Revisit only if a
  non-web consumer needs a genuinely independent lifecycle.

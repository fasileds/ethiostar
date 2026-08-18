# Architecture Decision Records

One file per decision that is expensive to reverse. Format: context → decision → consequences →
alternatives rejected. Short by design — an ADR nobody reads is an ADR nobody follows.

**Status values:** `Proposed` · `Accepted` · `Superseded by NNNN` · `Deprecated`.

**When to write one:** any choice that is hard to undo (data model, framework, protocol, security
posture), any deviation from these documents, and anything Phase 2 asks to add beyond the agreed
seams in [../architecture/07-extension-points.md](../architecture/07-extension-points.md).

| #                                                  | Decision                                                            | Status                     |
| -------------------------------------------------- | ------------------------------------------------------------------- | -------------------------- |
| [0001](0001-modular-monolith.md)                   | Modular monolith over microservices                                 | Accepted                   |
| [0002](0002-drizzle-over-prisma.md)                | Drizzle ORM with SQL migrations                                     | Accepted · amended by 0013 |
| [0003](0003-consignment-spine-and-stock-ledger.md) | Append-only stock ledger; consignment spine as its own module       | Accepted                   |
| [0004](0004-lookup-tables-over-enums.md)           | Lookup tables for business-configurable values                      | Accepted                   |
| [0005](0005-postgres-rls-as-defence-in-depth.md)   | RLS in addition to, not instead of, application scoping             | Accepted · amended by 0013 |
| [0006](0006-ports-only-where-justified.md)         | Ports and adapters only where a second implementation is plausible  | Accepted                   |
| [0007](0007-domain-events-and-outbox.md)           | Domain events with a transactional outbox                           | Accepted                   |
| [0008](0008-background-jobs.md)                    | Postgres-backed queue and a separate worker process                 | Accepted · amended by 0013 |
| [0009](0009-caching-posture.md)                    | Dynamic by default; `cacheComponents` off                           | Accepted                   |
| [0010](0010-custom-session-auth.md)                | Custom DB-backed session auth over an auth library                  | **Superseded by 0014**     |
| [0011](0011-authorization-model.md)                | Permission strings plus data scoping, checked in the use case       | Accepted                   |
| [0012](0012-pdf-rendering.md)                      | React-PDF behind a `DocumentRenderer` port                          | Accepted                   |
| [0013](0013-supabase-as-database-platform.md)      | **Supabase as the database platform** — what we take, what we don't | Accepted                   |
| [0014](0014-supabase-auth.md)                      | Supabase Auth (GoTrue) for authentication                           | Accepted                   |

**Read 0013 first if you are new to this codebase.** It is the decision that constrains the most
others, and its rule confining `service_role` to three sanctioned uses is the load-bearing security
control of the whole system.

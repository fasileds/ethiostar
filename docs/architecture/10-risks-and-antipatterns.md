# 10. Risks, Anti-Patterns and Technical-Debt Traps

Each entry: the mistake, why it is tempting, what it costs, and the rule that prevents it. Ordered
by how much damage it does in _this_ system specifically.

---

## 10.1 Architectural mistakes

### A1 — Storing current stock as a mutable column

**Tempting because** `UPDATE stock SET quantity = quantity - 500` is one line and obviously correct.

**Costs** the ability to answer "how did we get to 412 bags?", which is the only question that
matters in a custody dispute. It also loses concurrent updates, makes the physical-count variance
report meaningless, and cannot be repaired retrospectively because the history was never written.

**Rule:** the ledger is the source of truth; `stock_balance` is a projection that can be rebuilt from
it. A code-review check rejects any write to `stock_balance` outside `stock/infrastructure/`.

---

### A2 — Business logic in Server Actions

**Tempting because** the App Router makes it frictionless — the form, the handler and the query in
one file feels productive on day three.

**Costs** everything the mobile app (M22) and the API need, because the rule is not callable from
anywhere else. It also makes the rule untestable without a request context, so it stops being
tested, so it stops being right.

**Rule:** actions parse, delegate, and map errors. Nothing else. Enforced by a lint rule capping
`*.action.ts` at 40 lines and forbidding imports of `@db/*` from `interface/`.

---

### A3 — Status as a free-form column

**Tempting because** `status: string` and `if (status === 'received')` works immediately.

**Costs** the document's explicit requirement that no state may be skipped. Typos become states.
Six months in, `SELECT DISTINCT status` returns eleven values for a seven-state machine.

**Rule:** transitions only through the state machine; a database trigger validates against the
transition table; the exhaustive transition test is generated from the same table.

---

### A4 — A shared `utils/` and a shared `components/` folder

**Tempting because** every project starts one.

**Costs** the module boundaries. `utils/` becomes the place where a module reaches another module
without declaring a dependency, and `components/` becomes 400 files where nobody can tell what is
safe to change.

**Rule:** `core/` has named, purposeful subfolders and no `misc.ts`. UI lives with the route that
uses it, the module that owns it, or the design system — never in a general bucket. Reviewers reject
"utils" as a name.

---

### A5 — Modelling the customer twice

**Tempting because** M08 (onboarding) and M09 (portal) are separate modules in the document, so it
seems natural to give each its own customer notion.

**Costs** a permanent synchronisation bug. The document's module catalogue is a _delivery_ breakdown,
not a data-model breakdown.

**Rule:** one `customers` module below both. Where the client document's modules and the natural
aggregate boundaries disagree, follow the aggregate and note the mapping.

---

### A6 — Coupling modules by direct import instead of events

**Tempting because** `notification.send(...)` inside the receiving use case is obvious and works.

**Costs** the dependency graph, and then Phase 2. When M19 also needs to react to a receipt, it gets
added as a second direct call, and receiving now depends on billing.

**Rule:** an operational module emits; support modules subscribe. Enforced by the tier rules in §1.3.

---

### A7 — Treating the audit trail as logging

**Tempting because** "we log everything" feels equivalent.

**Costs** the evidential value. Logs are outside the transaction, sampled, rotated, and not
queryable by entity. The document requires before/after values per changed field and a permanent
record.

**Rule:** audit is a database table written in the business transaction. Logs are for operators;
audit is for disputes. Both, and never one instead of the other.

---

## 10.2 Data and correctness traps

### D1 — Floating point for weights

`0.1 + 0.2 = 0.30000000000000004`. Across a season this becomes a mass-balance variance nobody can
explain, in a report whose whole purpose is being explainable.

**Rule:** `numeric` in the database, string out of the driver, `Weight`/`Money` value objects in
code. A lint rule bans `parseFloat`/`Number()` on any column named `*_kg`, `*_amount` or `*_pct`.

---

### D2 — `timestamp` without time zone; or business dates computed in UTC

Ethiopia is UTC+3 with no DST. "Coffee received today" computed in UTC misfiles every receipt
between 21:00 and midnight local — roughly the end of every working day during peak intake.

**Rule:** `timestamptz` everywhere; business-date computation only in `core/utils/date.ts` against
`Africa/Addis_Ababa`; `TIME_ZONE=UTC` on every process so nothing depends on server locale.

---

### D3 — Postgres enums for business-configurable values

M02 explicitly requires additional output classifications "without redevelopment". A `CREATE TYPE`
makes that a migration, and removing a value later requires recreating the type and rewriting every
dependent column.

**Rule:** lookup tables with stable `code` columns for anything the business might extend.

---

### D4 — Deleting rows

A cancelled request, a corrected weight, a superseded document. Deletion destroys the trail that
Phase 3 anomaly detection and every dispute depend on.

**Rule:** status transitions and supersession chains. `DELETE` is not granted to `authenticated` on
append-only business tables at all — the temptation is removed rather than resisted. (`service_role`
is `REVOKE`d too; it bypasses RLS but not grants or triggers.)

---

### D5 — Not snapshotting printed documents

A GRN reprinted next year shows today's master data: a renamed coffee type, a changed standard bag
weight. The reprint silently contradicts the original.

**Rule:** `printed_document.payload_snapshot` holds everything the render used. Golden tests assert
a reprint matches the original byte-for-byte in its data fields.

---

### D6 — Losing the distinction between `occurred_at` and `recorded_at`

Coffee arrives at 17:40; the store keeper enters it at 09:10 the next morning. If only one timestamp
exists, dwell time, daily throughput and the delay analysis are all quietly wrong.

**Rule:** both columns on every operational record. Report explicitly on the gap — a growing gap is
an operational signal in its own right.

---

### D7 — Assuming one consignment equals one lot

It holds until the first partial processing run, then every query that joined on the assumption is
wrong.

**Rule:** lots are first-class from day one, with lineage edges. Never denormalise a lot's quantity
onto the consignment except as a derived, clearly named projection.

---

## 10.3 Scalability traps

| Trap                                       | Symptom                                                         | Prevention                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Summing the ledger per request             | Portal stock page degrades linearly through the season          | `stock_balance` projection, maintained transactionally                                          |
| N+1 across consignment → lots → movements  | 300 ms becomes 30 s on a busy customer                          | Explicit joins in the query layer; a dev-mode query counter that fails a test above a threshold |
| `OFFSET` pagination on ledger/audit        | Page 400 of the audit log times out                             | Keyset pagination helper; `OFFSET` banned by lint on those tables                               |
| Unbounded exports                          | One manager exporting a season OOMs the app instance            | Streamed CSV, hard row cap, background job + email link above the cap                           |
| PDF rendering inside a transaction         | Row locks held for seconds; receiving stalls plant-wide         | Rendering runs from the outbox, never in a business transaction                                 |
| Unpartitioned append-only tables           | `stock_movement` at 50 M rows; every index rebuild is an outage | Monthly `RANGE` partitioning from day one, while the tables are empty                           |
| Single worker assumed                      | Queue backs up; adding a second worker double-sends             | `FOR UPDATE SKIP LOCKED` and idempotent handlers from the first job                             |
| Connection exhaustion under HMR            | Local dev dies after ten saves                                  | Memoise the pool on `globalThis` in development                                                 |
| No statement timeout                       | One bad report query holds the plant                            | `statement_timeout` on the app role; long reports on the read-only role                         |
| Materialised views refreshed synchronously | Write latency spikes                                            | `REFRESH … CONCURRENTLY` from the worker on a schedule                                          |

---

## 10.3a Supabase-specific traps

Each of these is easy to hit, and most fail silently rather than loudly.

| Trap                                                      | Why it bites                                                                                                                                                                                     | Rule                                                                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Using `service_role` as the default server connection** | RLS is bypassed for every query. The system _looks_ secure — policies exist, the dashboard shows them green — and enforces nothing. This is the single worst mistake available on this platform. | Three sanctioned uses; one non-exported factory; CI allow-list on import sites ([adr/0013](../adr/0013-supabase-as-database-platform.md)) |
| Querying outside a transaction                            | No JWT context → evaluated as anonymous → empty results. Reads like a broken query, not a missing context.                                                                                       | All RLS-scoped access goes through `withAuthenticatedDb()`                                                                                |
| Session-scoped `set_config` instead of transaction-scoped | Under Supavisor transaction pooling the setting survives into the next request on that connection — a cross-tenant leak, not a performance nit                                                   | `set_config(..., true)` and `set local role`, always                                                                                      |
| Forgetting `prepare: false` on port 6543                  | Intermittent, confusing prepared-statement errors under load                                                                                                                                     | Encoded in the env schema check                                                                                                           |
| Changing schema in the dashboard                          | Drift no migration records; production and staging silently diverge                                                                                                                              | `supabase db diff --linked` in CI and in the deploy procedure                                                                             |
| New table shipped without RLS enabled                     | Readable by anyone with the anon key — which is in the browser bundle by design                                                                                                                  | Enable + `FORCE` on every `public` table; CI fails on a table with no policy                                                              |
| Public Storage bucket                                     | Every customer document world-readable by URL                                                                                                                                                    | All buckets private; signed URLs only                                                                                                     |
| Assuming the database backup covers Storage               | A restore yields `stored_file` rows pointing at objects that no longer exist                                                                                                                     | Back up the bucket separately; test restoring both together                                                                               |
| Assuming PITR is on                                       | It is a paid opt-in. Daily-only backups mean a 24-hour RPO on an evidential record                                                                                                               | Verify explicitly; record the check in the restore runbook                                                                                |
| Adding columns to `auth.users`                            | Supabase-owned and upgraded underneath you                                                                                                                                                       | Extend via `public.app_user` with an FK                                                                                                   |
| Trusting a JWT claim for authorization                    | Claims refresh only on token refresh; a revoked role persists up to one token lifetime                                                                                                           | Authorize in the use case against the DB; claims are for RLS scoping and optimistic UI                                                    |
| Shadowing GoTrue with our own sessions/MFA/invites        | Two systems that must never disagree — a defect generator                                                                                                                                        | GoTrue owns them; we own the profile                                                                                                      |
| No plan for the platform being unreachable                | Hosted Supabase makes internet a hard dependency for the gate and receiving screens                                                                                                              | `supabase-outage.md`, and the hosted-vs-self-hosted decision in [09 §9.0](09-operations.md)                                               |

## 10.4 Security traps specific to this system

| Trap                                         | Why it bites here                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Authorization only in `page.tsx`             | Server Actions are directly reachable POST endpoints. The page guard is not a guard. Re-authorize in every action.             |
| Authorization only in `proxy.ts`             | Proxy runs on prefetches and cannot do database checks cheaply. It is an optimistic redirect, not a control.                   |
| Permission without object-level check        | `delivery_request:view` lets a customer view _any_ request unless ownership is asserted. Classic IDOR.                         |
| Returning 403 for another tenant's id        | Confirms the id exists. Return 404.                                                                                            |
| RLS with session-scoped `set_config`         | Under Supavisor transaction pooling, the setting leaks to the next request. Always `set_config(..., true)` + `set local role`. |
| App connecting as `service_role` or owner    | Both bypass RLS entirely. Default path is `authenticated`; see §10.3a.                                                         |
| Emailing a temporary password                | A working credential lives in a mailbox forever. Send an activation link.                                                      |
| Sequential or guessable ids in QR codes      | Enumeration of other customers' lots. Random revocable tokens, not entity ids.                                                 |
| Trusting the uploaded MIME type              | A `.pdf` that is a script. Magic-byte sniff, allow-list, quarantine until scanned.                                             |
| Unescaped CSV export                         | `=cmd                                                                                                                          | ...`executes on a manager's machine. Escape leading`= + - @` in the one export helper. |
| Missing `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | Multi-instance deploys fail intermittently and inexplicably. Set it before the second instance exists.                         |
| `allowedOrigins` unset behind a proxy        | Every Server Action rejected in production, all working locally.                                                               |

---

## 10.5 Process and technical-debt traps

### P1 — Deferring the boundary enforcement tooling

Boundaries that are only in a document are decoration. Add `eslint-plugin-boundaries` and
`dependency-cruiser` in Step 1, before there is anything to violate. Adding them at 60% completion
means a week of untangling and a strong temptation to weaken the rules instead.

### P2 — Deferring the audit trail "until the flows work"

The audit trail is not a feature bolted onto flows; it is a property of how writes are performed.
Retrofitting it means revisiting every use case and accepting a permanent hole for everything
recorded before it landed.

### P3 — Building UI before the domain

Screens built first define the data model by accident, and the model that results is shaped by a
form layout rather than by the business. Build domain → use case → thin UI, per the roadmap order.

### P4 — Letting master data be "finished later"

The M02 key control exists because the same coffee grade spelled three ways makes the yield report
meaningless. Master data and its versioning land in Step 5, before any operational module writes a
reference to it.

### P5 — Skipping the workshop in the document's Next Steps

Section 11 item 2 calls for a joint workshop with Operations, Store and Finance to finalise business
rules, tolerances and approval thresholds. Every one of those is a `system_setting` in this design —
but the _list_ of settings, and which have thresholds at all, comes from that workshop. Building the
settings framework without holding it produces a configurable system configured with guesses.

### P6 — Treating printing (M06) as a formatting task

It is a factory-floor system with numbering, reprint control, watermarking, label stock, Ethiopic
fonts and evidential snapshots. Underestimating it is the most common schedule miss in projects of
this shape. Budget it as a real module.

### P7 — Letting Phase 2 leak in

"While we're here, let's add a price field." Every such addition is a guess at requirements that the
M10 workshop has not produced, and guessed schema is worse than absent schema. The seams in
[07-extension-points.md](07-extension-points.md) are the agreed limit; anything beyond needs an ADR.

### P8 — No `db/scripts` discipline

Someone runs an `UPDATE` in production to fix a bad row. It is not in version control, not audited,
and staging now differs from production in an unknown way. Data fixes are reviewed scripts, run
through the same pipeline, and they set `app.actor_id` so the audit trigger attributes them.

---

## 10.6 Open questions for EthioStar

To resolve in the Section 11 workshop, before the steps that depend on them. Each is cheap now and
expensive later.

1. **Legal and brand spelling of "EthioStar"** — it goes on every printed document. The client
   document itself flags this. Blocks the printing templates (Step 12).
2. **Mass-balance tolerance**, overall and per coffee type. Blocks Step 17's default settings.
3. **Approval thresholds** — what tonnage escalates a delivery request from Customer Service Officer
   to Operations Manager. Blocks Step 11.
4. **Free storage days and safe-fill %** — defaults only in Phase 1; free days are consumed by M20.
5. **Piece rates** per activity, bag weight class and shift, plus overtime/night/holiday multipliers.
   Blocks Step 19.
6. **Mandatory KYC documents per business type**, and their expiry rules. Blocks Step 9.
7. **Can a customer withdraw unprocessed coffee?** (`STORED → RELEASE_REQUESTED`.) One row in the
   transition table, but it changes the dispatch clearance rules.
8. **Document retention period** — statutory requirement drives partitioning and archival.
9. **Who witnesses a weighing**, and whether a witness is mandatory. Affects the receiving UI and a
   `NOT NULL`.
10. **Amharic requirement scope** — UI, printed documents, or both? Drives translation effort and
    font/layout work in M06.
11. **Whether a lot may be split or blended** across consignments. Lineage supports it; the business
    rules do not exist yet.
12. **Gate pass validity window** — how long after issue may a vehicle leave?
13. **Hosted or self-hosted Supabase, and in which region** — this is a data-residency and
    business-continuity decision, not a technical one. EthioStar holds third-party assets and
    commercially sensitive customer positions. Hosted means the gate and receiving screens depend on
    the plant's internet link. Blocks the production cut-over (Step 24) and
    [adr/0013](../adr/0013-supabase-as-database-platform.md).

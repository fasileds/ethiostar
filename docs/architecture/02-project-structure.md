# 2. Project Structure

The full structure for the **entire application**, not just Phase 1. Directories marked
`(P2)` / `(P3)` are _not created_ now — they are listed so that when Phase 2 or 3 arrives, the
placement question is already answered and nothing has to move.

Everything application-owned lives under `src/`. The repository root holds only tooling and
configuration. This is a supported Next.js layout (`src/app`), and it keeps the root readable as the
project grows past a hundred files.

---

## 2.1 Repository root

```
ethiostart/
├─ src/                        all application code (see §2.2)
├─ supabase/                   Supabase project: migrations, config, auth hook (see §2.7)
├─ db/                         seeds and one-off data scripts (see §2.7)
├─ tests/                      cross-module tests: e2e, fixtures, harness (see §2.8)
├─ docs/                       this documentation
├─ ops/                        docker, compose files, nginx, backup scripts, runbooks
├─ public/                     static assets: EthioStar logo/letterhead, fonts (incl. Amharic)
├─ .github/workflows/          CI: typecheck, lint, boundaries, unit, integration, e2e, build
├─ .env.example                every variable, documented, no secrets
├─ next.config.ts
├─ drizzle.config.ts
├─ vitest.config.ts
├─ playwright.config.ts
├─ eslint.config.mjs           flat config + boundaries plugin rules
├─ .dependency-cruiser.cjs     module dependency graph enforcement
├─ tsconfig.json
├─ package.json
├─ AGENTS.md / CLAUDE.md       (framework-managed; leave in place)
└─ README.md
```

`ops/` and `.github/` matter more than they look. An enterprise system with an audit-trail
obligation needs reproducible builds and a restorable database, and both are code.

---

## 2.2 `src/` top level

```
src/
├─ app/          Next.js App Router — ROUTING ONLY. Thin. No business logic. (§2.3)
├─ config/       environment parsing, runtime settings access, constants     (§2.4)
├─ core/         framework-agnostic kernel. Depends on nothing in src/.      (§2.5)
├─ db/           Drizzle client, schema, transaction/unit-of-work            (§2.6)
├─ modules/      feature modules — the bulk of the system                    (§2.9)
├─ platform/     infrastructure adapters implementing core/module ports      (§2.10)
├─ server/       composition root, auth entry point, action/HTTP wrappers    (§2.11)
├─ ui/           design system: presentational, business-agnostic            (§2.12)
├─ worker/       background worker process entry point                       (§2.13)
├─ proxy.ts      Next 16 proxy (formerly middleware) — edge-of-app concerns
└─ instrumentation.ts   server bootstrap: OTel, env validation, config warmup
```

---

## 2.3 `src/app/` — routing only

Route groups separate the four audiences. Each group has its own root-level layout, its own
navigation and its own auth posture. A customer and a store keeper never share a shell.

```
src/app/
├─ layout.tsx                     html/body, fonts (Latin + Ethiopic), providers, <html lang>
├─ error.tsx                      route-level error boundary
├─ global-error.tsx               last-resort boundary (own <html>)
├─ not-found.tsx
├─ globals.css
│
├─ (public)/                      unauthenticated, indexable
│  ├─ layout.tsx
│  ├─ page.tsx                              marketing landing
│  └─ apply/
│     ├─ page.tsx                           M08 public application form
│     ├─ _components/ApplicationWizard.tsx  multi-step client component
│     └─ status/[reference]/page.tsx        applicant tracks their reference
│
├─ (auth)/                        unauthenticated auth flows
│  ├─ layout.tsx
│  ├─ login/page.tsx
│  ├─ first-login/page.tsx                  M04 forced password change on issued credentials
│  ├─ forgot-password/page.tsx
│  ├─ reset-password/[token]/page.tsx
│  └─ mfa/page.tsx                          TOTP challenge
│
├─ (staff)/                       internal back office — session + staff realm required
│  ├─ layout.tsx                            shell, nav filtered by permissions
│  ├─ dashboard/page.tsx                    role-aware landing
│  ├─ applications/                         M08  list, [id] review, verify documents, approve
│  ├─ customers/                            customer master, documents, holds, contacts
│  ├─ delivery-requests/                    M11  list, [id], approve/reject, capacity proposal
│  ├─ receiving/                            M11  GRN capture, weighing, kesha confirmation
│  ├─ consignments/                         spine: list, [id] passport/timeline, lots
│  ├─ warehouse/                            M12  warehouses, rooms, sections, occupancy map
│  ├─ stock/                                ledger, balances, transfers, adjustments, counts
│  ├─ kesha/                                M13  empty-bag stock, reconciliation, customer bags
│  ├─ scheduling/                           M14  calendar, requests, appointments, delays
│  ├─ processing/                           M15  job list, [id] execution, outputs, mass balance
│  ├─ acceptance/                           M16  pending acceptance, Mirt Merekebiya
│  ├─ dispatch/                             M17  release requests, loading, gate passes
│  ├─ gate/                                 M17  security officer scan + gate-out screen
│  ├─ labour/                               M18  gangs, activities, earnings, vouchers
│  ├─ printing/                             M06  reprint centre, label printing
│  ├─ audit/                                M07  activity log search, coffee passport
│  └─ admin/                                M23  users, roles, master data, settings, series, support
│
├─ (portal)/                      customer self-service — session + customer realm required
│  ├─ layout.tsx
│  ├─ dashboard/page.tsx                    M09 kg/kesha by status, appointments, actions
│  ├─ stock/page.tsx                        live stock statement
│  ├─ delivery-requests/                    submit + track
│  ├─ processing-requests/                  submit + track
│  ├─ appointments/page.tsx
│  ├─ acceptances/[id]/page.tsx             review pack + sign Mirt Merekebiya
│  ├─ release-requests/                     submit + track
│  ├─ documents/page.tsx                    own documents, expiry warnings
│  └─ profile/                              contacts, password, sessions
│
└─ api/
   ├─ v1/
   │  ├─ applications/route.ts              POST public application (rate limited)
   │  ├─ files/route.ts                     POST upload (multipart, scanned)
   │  ├─ files/[id]/route.ts                GET authorized download (streamed, signed)
   │  ├─ documents/[id]/pdf/route.ts        GET rendered document PDF
   │  ├─ labels/route.ts                    POST label/tag PDF batch
   │  ├─ scan/[token]/route.ts              GET QR resolution → coffee passport
   │  └─ (P2) mobile/**                     M22 mobile endpoints, same use cases
   └─ internal/
      ├─ health/route.ts                    liveness — no DB
      ├─ ready/route.ts                     readiness — DB + storage + queue
      └─ metrics/route.ts                   Prometheus, protected
```

**Why route groups and not folders:** `(staff)` and `(portal)` need genuinely different root
layouts and different session guards. Route groups give that without polluting URLs. A customer's
URL is `/dashboard`, not `/portal/dashboard`.

**Why `_components` under a route:** UI used by exactly one route belongs to that route. The
underscore keeps it out of routing. Shared UI graduates to `src/modules/<m>/ui/` (business-aware) or
`src/ui/` (business-agnostic). This is what stops `components/` from becoming a 400-file dumping
ground.

---

## 2.4 `src/config/`

```
src/config/
├─ env.ts            Zod-parsed process.env. THE ONLY place process.env is read. Fails fast.
├─ env.client.ts     the NEXT_PUBLIC_ subset, separately typed
├─ constants.ts      compile-time constants: locales, timezone, currency, upload limits
├─ settings.ts       typed accessor for runtime business settings held in DB (M23)
└─ settings.schema.ts  Zod schema + defaults + metadata for every configurable setting
```

The split is the point: **`env` is infrastructure wiring; `settings` are business rules.** A
tolerance percentage, a free-storage-days count or an approval threshold must be changeable by an
authorised administrator without a deployment — the client document requires exactly that (M23). A
database URL must not be. Getting this wrong produces a system that needs a developer to change a
number, which is the failure M23 exists to prevent.

---

## 2.5 `src/core/` — the kernel

Pure TypeScript. No Next.js, no Drizzle, no React. Every module may import it; it imports nothing.

```
src/core/
├─ result/
│  └─ result.ts            Result<T,E>, ok(), err(), isOk(), map, andThen
├─ errors/
│  ├─ app-error.ts         base AppError { code, message, httpStatus, details, cause }
│  ├─ error-codes.ts       the enumerated catalogue — stable, documented, i18n keys
│  └─ errors.ts            NotFound, Forbidden, Unauthorized, Conflict, Validation,
│                          BusinessRuleViolation, ConcurrencyError, RateLimited
├─ types/
│  ├─ brand.ts             Brand<T, K> for nominal typing
│  ├─ ids.ts               CustomerId, ConsignmentId, LotId … branded UUIDs
│  └─ pagination.ts        Page<T>, PageRequest, Cursor
├─ units/
│  ├─ decimal.ts           exact decimal wrapper (no float arithmetic, ever)
│  ├─ weight.ts            Weight value object — kg, 3dp, add/sub/compare/percentOf
│  ├─ kesha.ts             KeshaCount — non-negative integer
│  ├─ money.ts             Money { amountMinor, currency } — arithmetic + rounding rules
│  └─ conversion.ts        kesha ↔ kg via bag type standard weight, with actual-weight override
├─ domain/
│  ├─ entity.ts            Entity<Id>, AggregateRoot (event buffer, version for optimistic locking)
│  ├─ value-object.ts
│  ├─ domain-event.ts      DomainEvent<TName, TPayload>, envelope with occurredAt/actor/correlation
│  ├─ state-machine.ts     generic guarded transition table + transition() helper
│  └─ specification.ts     composable predicate objects (used by eligibility checks)
├─ clock/clock.ts          Clock port + SystemClock. Nothing calls Date.now() directly.
├─ ids/id-generator.ts     IdGenerator port + UuidV7Generator
├─ logging/logger.ts       Logger port + child-logger contract + redaction rules
├─ observability/
│  ├─ context.ts           AsyncLocalStorage request context: requestId, actorId, correlationId
│  └─ metrics.ts           counter/histogram port
├─ i18n/
│  ├─ locale.ts            Locale = 'en' | 'am'
│  ├─ messages/            en.json, am.json — includes error-code messages
│  ├─ translate.ts
│  └─ ethiopian-calendar.ts   Gregorian ↔ Ethiopian conversion for display and documents
├─ validation/
│  ├─ zod.ts               shared refinements: TIN, phone (+251), positive decimal, date range
│  └─ sanitize.ts          CSV-injection escaping, filename sanitising, HTML stripping
└─ utils/
   ├─ assert.ts            invariant()/assertNever() — exhaustiveness on unions
   ├─ date.ts              business-day helpers in Africa/Addis_Ababa; UTC storage
   └─ hash.ts              sha256 helpers for file checksums and document integrity
```

Two of these are load-bearing and easy to skip:

- **`units/`** — a kilogram is not a `number`. Floats will silently break mass balance, and a
  mass-balance error in a custody business is a commercial dispute. `Weight` wraps an exact decimal
  and refuses float construction.
- **`clock/`** — every timestamp goes through an injected clock. Without it, scheduling, dwell time
  and delay logic cannot be tested deterministically, and they are exactly the logic that must be.

---

## 2.6 `src/db/`

```
src/db/
├─ client.ts             withAuthenticatedDb() — the DEFAULT path, sets request.jwt.claims +
│                        `set local role authenticated` per transaction so RLS applies.
│                        withServiceDb() — privileged, NOT exported from the barrel. See adr/0013.
├─ transaction.ts        UnitOfWork: run(fn(tx)), nested-call safety, retry on serialization failure
├─ types.ts              inferred row types, re-exported for infrastructure layers only
├─ helpers/
│  ├─ columns.ts         reusable column builders: id(), timestamps(), audit(), weightKg(), money()
│  ├─ pagination.ts      keyset pagination helper (never OFFSET on large tables)
│  └─ locks.ts           pg_advisory_xact_lock wrappers for numbering + capacity
└─ schema/
   ├─ index.ts           barrel — the only import surface for the schema
   ├─ enums.ts           PG enums for CLOSED technical sets only (see §04)
   ├─ identity.ts        M01
   ├─ master-data.ts     M02
   ├─ audit.ts           M07 + domain_event + outbox
   ├─ notification.ts    M04
   ├─ printing.ts        M06 numbering + printed documents + templates + qr tokens
   ├─ files.ts           stored files (M05 seam)
   ├─ warehouse.ts       M12
   ├─ customer.ts        customer master
   ├─ onboarding.ts      M08
   ├─ consignment.ts     consignment + lot + lineage + status history
   ├─ stock.ts           ledger + balances + reservations + counts + adjustments
   ├─ kesha.ts           M13
   ├─ inbound.ts         M11
   ├─ scheduling.ts      M14
   ├─ processing.ts      M15
   ├─ acceptance.ts      M16
   ├─ dispatch.ts        M17
   ├─ labour.ts          M18
   ├─ administration.ts  M23 settings, feature flags, support desk, job queue
   ├─ (P2) contract.ts   M10
   ├─ (P2) billing.ts    M19 / M20
   └─ (P3) ai.ts         M24–M28
```

One schema file per bounded area, not one giant `schema.ts`. Phase 2 adds files; it does not edit
Phase 1 files except to add a foreign key, which is additive.

---

## 2.7 `supabase/` and `db/` — migrations and data

```
supabase/
├─ config.toml               project config: auth settings, JWT expiry, SMTP, storage limits.
│                            COMMITTED — it is how local, staging and production stay identical.
├─ migrations/
│  ├─ 20260812090000_0001_enable_extensions_and_conventions.sql
│  ├─ 20260812091500_0002_create_identity_tables.sql
│  ├─ …
│  └─ 20260901120000_0022_create_reporting_views.sql
├─ functions/                (unused — Edge Functions are not part of this design; see adr/0013)
└─ .branches/, .temp/        CLI scratch — gitignored

db/
├─ seeds/
│  ├─ index.ts              idempotent, environment-aware runner
│  ├─ 010-permissions.ts     the permission catalogue (code-owned, synced every deploy)
│  ├─ 020-roles.ts           the 12 EthioStar roles + default role→permission map
│  ├─ 030-master-data.ts     coffee types, output classifications, bag types, reason codes
│  ├─ 040-settings.ts        default business settings + numbering series
│  └─ 900-demo.ts            demo/dev data only; refuses to run when NODE_ENV=production
└─ scripts/
   └─ YYYYMMDD-<description>.ts   one-off backfills, tracked and reviewed, never a migration
```

Full rules in [04-database-and-migrations.md](04-database-and-migrations.md).

---

## 2.8 `tests/`

```
tests/
├─ e2e/                 Playwright — the four business-critical journeys
│  ├─ onboarding.spec.ts, inbound.spec.ts, processing.spec.ts, dispatch.spec.ts
├─ integration/         cross-module flows against a real Postgres (Testcontainers)
├─ fixtures/            test data builders — aCustomer(), aConsignment().withLots(3)
├─ support/
│  ├─ db.ts             container lifecycle, migrate, truncate-between-tests
│  ├─ auth.ts           authenticated Playwright storage states per role
│  └─ clock.ts          FrozenClock
└─ global-setup.ts
```

Unit tests are co-located next to the code under test (`mass-balance.test.ts` beside
`mass-balance.ts`) — they are documentation of the module, and separating them from it guarantees
they rot.

---

## 2.9 `src/modules/` — the shape of one module

Every module follows the same shape. Uniformity is what lets a new developer open any module and
know where to look.

```
src/modules/<module>/
├─ index.ts                    PUBLIC API of the module. Others import ONLY from here.
├─ domain/
│  ├─ <entity>.entity.ts
│  ├─ <name>.vo.ts
│  ├─ <name>.policy.ts         pure decision logic
│  ├─ <name>.state-machine.ts
│  ├─ events.ts                domain events this module emits
│  └─ errors.ts                module-specific error codes
├─ application/
│  ├─ ports/                   interfaces this module needs someone else to implement
│  │  └─ <name>.port.ts
│  ├─ <verb>-<subject>.usecase.ts
│  └─ <name>.query.ts          read-side queries (return DTOs, not entities)
├─ infrastructure/
│  ├─ <entity>.repository.ts   Drizzle implementation
│  ├─ <entity>.mapper.ts       row ↔ entity
│  └─ <name>.adapter.ts
├─ interface/
│  ├─ schemas/<subject>.schema.ts   Zod input contracts
│  ├─ actions/<verb>-<subject>.action.ts
│  ├─ controllers/<name>.controller.ts   used by route handlers
│  └─ dto/<name>.dto.ts
├─ ui/                         module-owned React components (business-aware)
└─ <various>.test.ts           co-located unit tests
```

`index.ts` is the enforcement point for encapsulation: ESLint forbids deep imports
(`@/modules/x/domain/...`) from outside the module. Refactoring inside a module then cannot break
another module, which is the whole point of the boundary.

### The Phase 1 module set

| Module           | Module code | Owns                                                                                                                                           |
| ---------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity`       | M01         | users, roles, permissions, sessions, data scopes, password policy, MFA                                                                         |
| `master-data`    | M02         | coffee/grade/region/woreda/harvest-year/screen-size/certification, output classifications, bag types, reason codes, effective-dated versioning |
| `audit`          | M07         | row-level audit log, domain event store, outbox, coffee-passport assembly                                                                      |
| `notification`   | M04         | templates, rendering, queueing, delivery attempts, immutable log                                                                               |
| `printing`       | M06         | numbering series, PDF rendering, labels/tags, barcode + QR, printed-document registry, reprint control                                         |
| `files`          | (M05 seam)  | stored files, checksum, MIME allow-list, virus-scan status, entity links                                                                       |
| `warehouse`      | M12         | warehouse→room→section, capacity engine, safe-fill thresholds, reservations, availability check                                                |
| `customers`      | —           | customer master, contacts, documents, expiry, holds                                                                                            |
| `onboarding`     | M08         | public application, KYC checklist, document verification, approval, credential issue                                                           |
| `stock`          | —           | append-only ledger, balance projection, transfers, adjustments, physical counts                                                                |
| `kesha`          | M13         | bag types, empty-bag inventory, customer-owned bags, bag reconciliation                                                                        |
| `labour`         | M18         | gangs, workers, piece rates, activities, earnings, payment vouchers                                                                            |
| `consignment`    | —           | consignment + lot aggregates, lifecycle state machine, lineage                                                                                 |
| `inbound`        | M11         | delivery request, capacity check, approval, goods receipt, weighing, placement                                                                 |
| `scheduling`     | M14         | processing requests, eligibility, appointments, reschedule/delay cascade                                                                       |
| `processing`     | M15         | job orders, four-way outputs, mass balance, process loss                                                                                       |
| `acceptance`     | M16         | acceptance pack, Mirt Merekebiya, signature capture                                                                                            |
| `dispatch`       | M17         | release requests, clearance, loading, gate pass, gate-out                                                                                      |
| `portal`         | M09         | customer read models and customer-initiated use cases                                                                                          |
| `administration` | M23         | settings console, numbering config, support desk, system health                                                                                |

`customers`, `stock` and `consignment` are not module codes in the client document. They exist
because the alternative is duplicating the customer aggregate across M08/M09, duplicating the
lifecycle across M11–M17, and — worst — letting each operational module keep its own idea of "how
much is in stock". Extracting them is the single biggest structural decision in the plan; see
[adr/0003-consignment-spine-and-stock-ledger.md](../adr/0003-consignment-spine-and-stock-ledger.md).

---

## 2.10 `src/platform/` — infrastructure adapters

Concrete implementations of ports. Swappable, individually testable, each with a fake for tests.

```
src/platform/
├─ supabase/        server client factories: anon (public routes), user-scoped (@supabase/ssr),
│                   admin (service key — auth.admin calls only, narrow and audited)
├─ mailer/          SmtpMailer (nodemailer), ConsoleMailer (dev), FakeMailer (test).
│                   Transactional auth email (invite, reset) is GoTrue's, not ours.
├─ storage/         SupabaseFileStorage (private buckets + signed URLs), FakeFileStorage (test)
├─ antivirus/       ClamAvScanner, NoopScanner (dev, logs loudly)
├─ pdf/             ReactPdfRenderer + shared letterhead/footer primitives
├─ barcode/         QrGenerator, Code128Generator
├─ queue/           PostgresQueue (FOR UPDATE SKIP LOCKED) + OutboxRelay
├─ cache/           InMemoryCache, (P2) RedisCache
├─ ratelimit/       PostgresRateLimiter (fixed window + token bucket)
├─ crypto/          AES-GCM field encryption, token generator. No password hasher — GoTrue hashes.
└─ (P3) ai/         M24–M28 provider adapters
```

None of these are imported directly by a use case — the use case depends on the port, and
`src/server/container.ts` wires the implementation. That is what makes the application layer
testable without SMTP, S3 or ClamAV running.

---

## 2.11 `src/server/`

```
src/server/
├─ container.ts          composition root: builds and memoises adapters, exposes typed getters
├─ auth/
│  ├─ session.ts         GoTrue session read/refresh via @supabase/ssr cookie handling
│  ├─ dal.ts             getActor(), requireActor(), requireStaff(), requireCustomer() [React cache].
│  │                     Re-reads app_user.status every request — this is what makes revocation
│  │                     effectively immediate despite JWT lifetime. See adr/0014.
│  ├─ claims.ts          typed reader for the custom access token claims
│  ├─ authorize.ts       requirePermission(actor, perm, scope) — the single decision point
│  ├─ scope.ts           data-scope resolution (branch / warehouse / room / own-customer)
│  └─ password.ts        change-password use case, history check, forced-change flag
├─ actions/
│  ├─ with-action.ts     the Server Action wrapper: context, actor, rate limit, error mapping
│  └─ action-result.ts   ActionResult<T> discriminated union returned to the client
├─ http/
│  ├─ with-route.ts      route handler wrapper: same guarantees for the HTTP surface
│  ├─ problem.ts         RFC 9457 problem+json responses
│  └─ idempotency.ts     Idempotency-Key handling for POST endpoints
└─ events/
   ├─ bus.ts             in-process publish within a transaction (append to outbox)
   └─ registry.ts        subscription table: event name → handler list
```

`dal.ts` is the "Data Access Layer" the Next.js security guide prescribes: one place that resolves
the caller, wrapped in React `cache()` so a render pass resolves the session once. Nothing reads the
session cookie except this file.

---

## 2.12 `src/ui/`

```
src/ui/
├─ primitives/     Button, Input, Select, Dialog, Table, Toast, Badge, Tabs …
├─ patterns/       DataTable (sortable/filterable/paged), FormField, EmptyState, ConfirmDialog,
│                  PageHeader, StatCard, Stepper, FileDropzone, DateField (dual calendar)
├─ layout/         AppShell, SideNav, TopBar, Breadcrumbs
├─ charts/         thin wrappers — kept minimal in Phase 1; M21 (P2) builds on these
├─ hooks/          useDebounce, useOptimisticAction, usePermission, useLocale
└─ styles/         tokens.css (colours, spacing, EthioStar brand), print.css
```

Rule: `src/ui` knows nothing about coffee. A component that renders a consignment status badge is
business-aware and belongs in `src/modules/consignment/ui/`. Keeping this line is what makes the
design system reusable and the module UI meaningful.

---

## 2.13 `src/worker/`

A **separate process**, same codebase, same container image, different entry point.

```
src/worker/
├─ main.ts            entry: env validation, graceful shutdown, health socket
├─ runner.ts          poll loop over job_queue with FOR UPDATE SKIP LOCKED
├─ handlers/
│  ├─ send-notification.handler.ts
│  ├─ relay-outbox.handler.ts
│  ├─ rebuild-stock-balance.handler.ts
│  ├─ document-expiry-scan.handler.ts     M05-adjacent: expiring KYC documents (M08 control)
│  ├─ capacity-threshold-scan.handler.ts  M12 safe-fill alerts
│  ├─ ageing-stock-scan.handler.ts        dwell-time alerts
│  ├─ session-cleanup.handler.ts
│  └─ balance-reconciliation.handler.ts   ledger vs projection drift detector
└─ schedules.ts       cron-like definitions for the recurring scans
```

Why not `after()` or a route hit by cron: `after()` is best-effort and dies with the request — it is
right for logging, wrong for a notification the business must prove it sent. Notification delivery,
retry and dead-lettering need durable state, which means a queue table and a process that owns it.
Using Postgres for the queue avoids adding Redis for a plant that processes tens of thousands of
rows a season. See [adr/0008-background-jobs.md](../adr/0008-background-jobs.md).

---

## 2.14 `src/proxy.ts`

Next 16 renamed `middleware` to `proxy`; the runtime is Node.js and is not configurable. It runs on
every matched request including prefetches, so it stays cheap and does **optimistic** checks only.

Responsibilities, in order:

1. Generate/propagate `x-request-id` and `x-correlation-id`.
2. Attach security headers and the CSP nonce.
3. **Refresh the Supabase session cookie** (`@supabase/ssr` requires this in proxy/middleware —
   without it, server components see an expired token and the user is logged out mid-session; with a
   5-minute access token TTL this is not optional).
4. Decode the JWT claims **without a database call** and redirect unauthenticated users away from
   `(staff)` and `(portal)`, and authenticated users away from `(auth)`.
5. Force the first-login password change by redirecting when the `must_change_password` claim is set.
6. Resolve locale and set `<html lang>` via a header.

It is explicitly **not** the authorization layer. Real permission checks happen in the use case,
next to the data. Proxy runs on prefetched routes and cannot be trusted as the only gate.

---

## 2.15 `tsconfig.json` paths

```jsonc
"paths": {
  "@/*":         ["./src/*"],
  "@core/*":     ["./src/core/*"],
  "@db/*":       ["./src/db/*"],
  "@config/*":   ["./src/config/*"],
  "@modules/*":  ["./src/modules/*"],
  "@platform/*": ["./src/platform/*"],
  "@server/*":   ["./src/server/*"],
  "@ui/*":       ["./src/ui/*"]
}
```

Distinct aliases make a boundary violation visible in the import line itself, and they give
`eslint-plugin-boundaries` clean patterns to match. Also set `"target": "ES2022"` (Node 20 supports
it; the scaffold's ES2017 is unnecessarily conservative) and enable
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`.

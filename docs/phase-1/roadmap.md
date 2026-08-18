# Phase 1 — Implementation Roadmap

24 steps in dependency order. Each step lists what to build, the files, the dependencies, and a
definition of done. A step is not finished until its DoD passes in CI.

**Ordering principle:** foundations before domain, domain before UI, and each operational module in
the order the coffee physically moves. Steps 1–8 build nothing a user sees, which is uncomfortable
and correct — every one of them is something that cannot be retrofitted cheaply.

| Stage      | Steps | Theme                                                                    |
| ---------- | ----- | ------------------------------------------------------------------------ |
| Foundation | 1–8   | Tooling, config, database, kernel, auth, audit, events, jobs             |
| Platform   | 9–13  | Master data, files, notification, printing, warehouse                    |
| Customer   | 14–15 | Onboarding, customer master, portal shell                                |
| Operations | 16–21 | Consignment spine, inbound, scheduling, processing, acceptance, dispatch |
| Support    | 22–24 | Labour, administration, hardening & UAT                                  |

Rough shape: foundation ≈ 30% of effort, operations ≈ 45%, the rest ≈ 25%. Teams routinely invert
that and pay for it in the last month.

---

# Stage A — Foundation

## Step 1 — Project skeleton, tooling and boundary enforcement

**Goal:** the structure exists and cannot be violated by accident.

**Do:**

- Move `app/` → `src/app/`. Update `tsconfig.json` paths to the aliases in
  [../architecture/02-project-structure.md §2.15](../architecture/02-project-structure.md).
- Raise `target` to `ES2022`; enable `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `noImplicitOverride`.
- Create the full directory tree (empty `index.ts` barrels are fine) so nobody has to invent a
  location later.
- `next.config.ts`: `output: 'standalone'`, `typedRoutes: true`, `poweredByHeader: false`,
  `reactStrictMode: true`, `serverExternalPackages`.
- ESLint flat config + `eslint-plugin-boundaries` with the tier rules from §1.3; Prettier;
  `.dependency-cruiser.cjs` forbidding cycles and deep cross-module imports.
- Custom lint rules: `no-restricted-properties` for `process.env` outside `src/config`; ban
  `new Date()`/`Date.now()` outside `core/clock` and `core/utils/date`; max file 300 lines.
- Vitest config with two projects (`unit`, `integration`); Playwright config.
- `.github/workflows/ci.yml` running the eleven gates in
  [../architecture/08-testing.md §8.4](../architecture/08-testing.md).
- `supabase init` (project scaffold); `ops/docker-compose.dev.yml` for **clamav only** — Postgres,
  auth, storage and the mail catcher all come from `supabase start`.

**Files:** `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `.dependency-cruiser.cjs`,
`vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `ops/docker-compose.dev.yml`,
`package.json` scripts.

**DoD:** `npm run verify` (typecheck + lint + boundaries + test + build) passes on an empty project.
A deliberately added cross-tier import **fails CI** — demonstrate this, do not assume it.

**Why first:** see [../architecture/10-risks-and-antipatterns.md](../architecture/10-risks-and-antipatterns.md) P1.
Retrofitting boundaries at 60% completion costs a week and usually ends with the rules being
weakened.

---

## Step 2 — Configuration and environment management

**Do:**

- `src/config/env.ts` — Zod schema over `process.env`, parsed once, throws at boot. Separate
  `env.client.ts` for the `NEXT_PUBLIC_` subset.
- `src/config/constants.ts` — locales, `Africa/Addis_Ababa`, `ETB`, upload limits, cookie names.
- `src/config/settings.schema.ts` — declare every runtime business setting with type, default, unit,
  description and `editableByRole`. Start with: mass-balance tolerance, safe-fill %, free storage
  days, session timeouts, approval thresholds, document-expiry warning days, rate limits.
- `src/config/settings.ts` — typed accessor with a 60 s cache, invalidated on write. Backed by
  `system_setting` (created in Step 3); until then it reads defaults.
- `src/instrumentation.ts` — `register()` calls `env` parsing and OTel setup.
- `.env.example` — every variable documented.

**Files:** as listed.

**DoD:** the app refuses to start with a missing or malformed variable, and the error names the
variable. `settings.get()` is typed — a typo is a compile error.

---

## Step 3 — Supabase project, database foundation and migration pipeline

**Depends on:** 2.

**Do:**

- `supabase init`; commit `supabase/config.toml`. Set JWT expiry to **300 s**, password minimum 12,
  leaked-password protection on, redirect URLs, SMTP.
- Create the staging and production projects (separate projects, not schemas). Link the repo.
- `drizzle.config.ts` (uses `DIRECT_URL`); `src/db/client.ts` with **both** paths:
  `withAuthenticatedDb()` (default — `set_config('request.jwt.claims')` + `set local role
authenticated`) and `withServiceDb()` (**not exported from the barrel**). `prepare: false`,
  `globalThis` memo in dev.
- `src/db/transaction.ts` (UnitOfWork, retry on serialization failure).
- `src/db/helpers/columns.ts` — `id()`, `timestamps()`, `auditColumns()`, `weightKg()`,
  `keshaCount()`, `money()`, `versionColumn()`. **Numeric mode returns strings.** Every table uses
  these; nothing declares a raw numeric column.
- `src/db/helpers/pagination.ts` (keyset), `src/db/helpers/locks.ts` (advisory locks).
- Migration `…_0001_enable_extensions_and_conventions.sql`: `pgcrypto`, `citext`, `btree_gist`,
  `pg_trgm`, `pg_cron`; `fn_set_updated_at`, `fn_block_mutation`, `fn_audit_row`; grants and
  `REVOKE`s for `anon` / `authenticated` / `service_role`.
- Scripts: `db:generate` (drizzle-kit), `db:migrate` (`supabase db push`), `db:reset`, `db:seed`,
  `db:diff`.
- `tests/support/db.ts` — local Supabase or Testcontainers lifecycle, migrate, truncate-between-tests.
- CI: `supabase db reset` on empty; apply onto a restored dump; `drizzle-kit check`;
  `supabase db diff --linked` must be empty.
- **CI guard: an allow-list of files permitted to import `withServiceDb`.** Add it now, while the
  list has one entry.

**DoD:** migrations apply and re-apply cleanly; an integration test proves a query through
`withAuthenticatedDb` is RLS-constrained and the same query through `withServiceDb` is not
(demonstrating you understand which is which); the drift check passes; `prepare: false` is verified
against the pooler.

---

## Step 4 — The kernel (`src/core`)

**Depends on:** 1.

**Do:** everything in
[../architecture/02-project-structure.md §2.5](../architecture/02-project-structure.md) — `Result`,
the `AppError` hierarchy and error-code catalogue, branded ids, `Decimal`/`Weight`/`KeshaCount`/
`Money`, unit conversion, `Entity`/`AggregateRoot`/`DomainEvent`, the generic state-machine helper,
`Clock`, `IdGenerator`, `Logger`, request context (`AsyncLocalStorage`), metrics, i18n scaffolding
with the Ethiopian calendar converter, Zod refinements (TIN, +251 phone, positive decimal), and
sanitisation (CSV injection, filenames).

**Test heavily here.** These are pure functions used by everything; a bug is systemic. Property-based
tests for `Weight` and `Money`.

**DoD:** unit coverage ≥ 90% on `src/core`; `Weight` cannot be constructed from a float or a
negative; the state-machine helper rejects an undeclared transition.

---

## Step 5 — Identity and access (M01)

**Depends on:** 3, 4.

**Do:**

- Migration `…_0002_create_identity_tables.sql`: `app_user` (**`id` FK → `auth.users(id)`**),
  `user_password_history`, `user_login_attempt`, `role`, `permission`, `role_permission`,
  `user_role`, `user_scope`, `permission_group`.
  **Do not create** `user_session`, `user_mfa_totp` or `user_invitation` — GoTrue owns those.
- `public.custom_access_token_hook(event jsonb)` injecting `actor_kind`, `customer_id`, `role`,
  `scope`, `must_change_password`, `permissions_version`, `status`. Grant `EXECUTE` to
  `supabase_auth_admin`, revoke from `authenticated` / `anon` / `public`. Register it in
  `config.toml`.
- Trigger on `auth.users` insert → create the `app_user` profile row.
- `src/modules/identity/domain/` — `Role`, `Permission`, `Scope`, password-history policy.
- `src/modules/identity/application/` — `create-staff-user`, `invite-customer-user`, `assign-role`,
  `change-password`, `suspend-user`, `revoke-sessions`, `require-mfa`.
- `src/platform/supabase/` — anon, user-scoped (`@supabase/ssr`) and admin client factories.
- `src/platform/crypto/` — AES-GCM field encryption (bank details). **No password hasher** — GoTrue
  hashes.
- `src/server/auth/` — `session.ts` (GoTrue via `@supabase/ssr`), `claims.ts`, `dal.ts`
  (`getActor`/`requireActor`/... in React `cache`, **re-reading `app_user.status` per request**),
  `authorize.ts`, `scope.ts`, `password.ts`.
- `src/proxy.ts` — request id, security headers + CSP nonce, **Supabase session cookie refresh**,
  optimistic redirect from claims, forced first-login redirect, locale.
- `src/app/(auth)/` — login, first-login, forgot/reset password, MFA enrol + challenge.
- Seeds `010-permissions.ts` (catalogue, code-owned) and `020-roles.ts` (12 roles).
- Restyle GoTrue's email templates to EthioStar identity; configure production SMTP.

**DoD:** login/logout work and the session survives past 5 minutes (proving the proxy refresh is
wired — this is the most common `@supabase/ssr` mistake); `requirePermission` denies by default and
audits the denial; the Auditor role holds no write permission (asserted by test); forced password
change cannot be bypassed by navigating directly; **suspending a user blocks their next request
even though their JWT is still valid** (proves the DAL status re-read); MFA is enforced for
privileged roles.

---

## Step 6 — Audit trail and domain events (M07)

**Depends on:** 3, 5.

**Do:**

- Migration `0003_create_audit_and_event_tables.sql`: `audit_log`, `domain_event`, `outbox`,
  `outbox_dead_letter`. Append-only triggers + `REVOKE`. Partition `audit_log` and `domain_event` by
  month.
- `fn_audit_row()` trigger attached to every business table as they are created; it reads
  `app.actor_id` and **raises if unset**.
- `src/modules/audit/` — event store (`append(tx, events)`), audit query service, the coffee-passport
  assembler (recursive CTE over lineage + events + movements).
- `src/server/events/bus.ts` and `registry.ts` — in-transaction append + subscriber registry.
- `src/app/(staff)/audit/` — searchable activity log with before/after diff rendering.

**DoD:** a write with no actor context is rejected by the database; `UPDATE`/`DELETE` on `audit_log`
raises when attempted as `authenticated` **and** as `service_role` (the trigger fires regardless of
role — this is why append-only tables get triggers, not just grants); the passport query returns a
correct ordered timeline for a seeded consignment.

**Why here:** every subsequent step attaches to this. Building it after the operational modules means
revisiting all of them (P2).

---

## Step 7 — Background jobs, outbox relay and the worker process

**Depends on:** 3, 6.

**Do:**

- Migration `0020` (partial — the job tables): `job_queue`, `job_queue_history`, `scheduled_task`.
- `src/platform/queue/` — `PostgresQueue` with `FOR UPDATE SKIP LOCKED`, exponential backoff with
  jitter, dead-lettering, idempotency keys; `OutboxRelay`.
- `src/worker/main.ts` (graceful shutdown on SIGTERM), `runner.ts`, `schedules.ts` with a
  leader-election advisory lock.
- Metrics: queue depth, outbox lag, job duration, dead-letter count.

**DoD:** two worker instances against one queue process each job exactly once; a failing handler
retries and dead-letters after `max_attempts`; SIGTERM drains in-flight jobs before exit.

---

## Step 8 — Error handling, logging, and the entry-point wrappers

**Depends on:** 4, 5, 6.

**Do:**

- `src/server/actions/with-action.ts` and `action-result.ts`.
- `src/server/http/with-route.ts`, `problem.ts` (RFC 9457), `idempotency.ts`.
- `src/platform/ratelimit/` — Postgres limiter.
- Logger wiring: pino + request context + allow-list redaction.
- `src/app/error.tsx`, `global-error.tsx`, `not-found.tsx`, plus per-route-group `error.tsx`.
- OTel spans on HTTP, database and jobs.

**DoD:** an unhandled error returns a generic message plus a request id, and the full detail appears
in the log under that id; a Server Action without a declared permission fails to compile/run; rate
limits return `429` with `Retry-After`.

---

# Stage B — Platform

## Step 9 — Master data (M02)

**Depends on:** 5, 6.

**Do:**

- Migration `0004_create_master_data_tables.sql` — the 21 tables in
  [../architecture/04-database-and-migrations.md §4.5](../architecture/04-database-and-migrations.md),
  including `bag_type_version` with the `EXCLUDE USING gist` no-overlap constraint.
- `src/modules/master-data/` — CRUD use cases with effective-dated versioning, `code` immutability
  after first use, deactivation instead of deletion, and a resolver
  (`bagTypeAt(id, date) → version`).
- `src/app/(staff)/admin/master-data/` — a generic list/edit UI driven by a per-entity descriptor, so
  twenty entities do not become twenty hand-built screens.
- Seed `030-master-data.ts`: the four output classifications (`APPROVED` with `is_primary`,
  `C_GRADE`, `GRAVITY`, `COLOUR_SORTER`), coffee types (washed/natural/semi-washed), regions and
  woredas, bag types, reason codes, activity types, shifts.

**DoD:** the effective-date overlap constraint rejects an overlapping version; a code cannot be
changed once referenced; a fifth output classification can be added through the UI with no code
change (this is the M02 key control, so test it explicitly).

---

## Step 10 — File service (the M05 seam)

**Depends on:** 5, 7.

**Do:**

- Migration `…_0008_create_file_tables.sql`: `stored_file`, `file_link`, `file_scan_result`; the
  **private** Storage bucket and its `storage.objects` RLS policies.
- `src/platform/storage/` — `SupabaseFileStorage` (private bucket, short-lived signed URLs),
  `FakeFileStorage`.
- `src/platform/antivirus/` — `ClamAvScanner`, `NoopScanner` (refuses to load in production).
  Supabase does not scan uploads; this stays ours.
- `src/modules/files/` — upload use case (magic-byte sniff, allow-list, size cap, sha256, quarantine),
  authorized download, link/unlink, supersede, expiry.
- `src/app/api/v1/files/route.ts` (POST) and `files/[id]/route.ts` (GET, streamed, scope-checked).
- `src/ui/patterns/FileDropzone.tsx`.
- Worker handler: document-expiry scan.

**DoD:** a file whose magic bytes contradict its extension is rejected; a `PENDING` or `INFECTED`
file cannot be downloaded or linked; a customer cannot download another customer's file (404); **the
bucket is private and a raw object URL without a signature returns 400/403**; signed URLs expire.

---

## Step 11 — Notifications (M04)

**Depends on:** 7, 9.

**Do:**

- Migration `0010_create_notification_tables.sql`, append-only on `notification` and
  `notification_delivery_attempt`.
- `src/platform/mailer/` — `SmtpMailer`, `ConsoleMailer`, `FakeMailer`.
- `src/modules/notification/` — `NotificationChannel` port, template rendering (with locale
  selection), send use case, delivery-attempt recording, preferences, the event→template subscriber
  registry.
- Seed all Phase 1 templates in `en` and `am`.
- Worker handler `send-notification`.
- `src/app/(staff)/admin/notifications/` — template management and a delivery log.

**DoD:** the rendered body is persisted, not just the template reference; nothing is deletable; a
transient SMTP failure retries and eventually dead-letters with an alert; changing a template does
not alter previously sent messages.

---

## Step 12 — Printing, labelling and QR (M06)

**Depends on:** 5, 9, 10.

**Do:**

- Migration `0009_create_printing_tables.sql`: `document_number_series`, `document_template`,
  `label_template`, `printed_document`, `qr_token`.
- `src/modules/printing/domain/number-series.ts` — allocation with `SELECT … FOR UPDATE`, yearly
  reset, gapless.
- `src/platform/pdf/` — `ReactPdfRenderer`, shared `Letterhead`, `Footer` (number + timestamp +
  printed-by), `SignatureBlock`, `DataTable`, `WatermarkDuplicate`, `QrBlock`; Ethiopic + Latin
  fonts embedded.
- `src/platform/barcode/` — QR and Code128.
- `src/modules/printing/application/` — `renderDocument(type, entityId, locale)` which allocates the
  number, snapshots the payload, renders, and writes `printed_document`; `reprint` incrementing
  `copy_number`.
- `src/app/api/v1/documents/[id]/pdf/route.ts`, `labels/route.ts`, `scan/[token]/route.ts`.
- `src/app/(staff)/printing/` — reprint centre and label batch printing.
- Templates for whichever documents exist so far; the rest are added by their owning step.

**DoD:** concurrent allocation produces contiguous numbers with no gaps or duplicates; a rolled-back
transaction does not consume a number; a reprint is watermarked and increments `copy_number`; a
reprint of an old document reproduces the original figures from the snapshot; an unauthenticated QR
scan reveals no customer data.

**Budget realistically** — see [../architecture/10-risks-and-antipatterns.md](../architecture/10-risks-and-antipatterns.md) P6.

---

## Step 13 — Warehouse and capacity engine (M12)

**Depends on:** 6, 9.

**Do:**

- Migration `0005_create_warehouse_tables.sql`: `warehouse`, `store_room`, `store_section`,
  `capacity_reservation`, `location_alert_threshold`.
- `src/modules/warehouse/domain/` — the location hierarchy, `CapacityCalculator`,
  `PlacementStrategy` port + `BestFitPlacementStrategy`, safe-fill thresholds.
- `src/modules/warehouse/application/` — `checkAvailability` (returns a **placement proposal or a
  reason**), `reserveCapacity` (under advisory lock), `consumeReservation`, `releaseReservation`,
  `expireReservations` (worker).
- `src/app/(staff)/warehouse/` — hierarchy management, occupancy view with a visual map, threshold
  configuration.
- Worker handler: capacity-threshold scan → alert notification.

**DoD:** capacity arithmetic is correct across all three levels including reservations; two
concurrent reservations for the same room where only one fits — exactly one succeeds and the other
receives a capacity error; a proposal never exceeds available capacity.

---

# Stage C — Customer

## Step 14 — Customer master and onboarding (M08)

**Depends on:** 5, 9, 10, 11, 12.

**Do:**

- Migrations `0006_create_customer_tables.sql`, `0007_create_onboarding_tables.sql`.
- `src/modules/customers/` — `Customer` aggregate, contacts, documents, `customer_hold`,
  **`CustomerHoldPolicy` port + `DocumentComplianceHoldPolicy`**
  ([../architecture/07-extension-points.md](../architecture/07-extension-points.md) Seam 4).
- `src/modules/onboarding/` — public application submission (returns a tracking reference),
  the configurable per-business-type document checklist, per-document verification, review
  decisions, approval → customer creation → credential issue → notification.
- `src/app/(public)/apply/` — multi-step wizard, `src/app/(public)/apply/status/[reference]`.
- `src/app/api/v1/applications/route.ts` — rate limited, honeypot.
- `src/app/(staff)/applications/` — queue, review screen with document viewer and verify/reject per
  document, approve/reject with mandatory comment.
- Documents: application acknowledgement, registration certificate, credential letter.

**DoD:** an application cannot be approved while any mandatory document is unverified or expired
(the M08 key control — test it); approval creates the user, issues an activation link (never a
plaintext password), emails it, and the customer can complete first login; the tracking reference
works without an account and reveals only status.

---

## Step 15 — Portal shell and customer dashboard (M09, part 1)

**Depends on:** 5, 14.

**Do:**

- `src/app/(portal)/layout.tsx` — customer shell, hard-scoped session guard.
- `src/modules/portal/application/dashboard.query.ts` — the read model: kg and kesha by status,
  upcoming appointments, pending actions, recent activity. **The outstanding-balance slot exists but
  is not rendered** (boundary ruling B4).
- `src/app/(portal)/dashboard`, `stock`, `documents`, `profile` (contacts, password, active
  sessions).
- `src/ui/patterns/` — `DataTable`, `StatCard`, `PageHeader`, `EmptyState`, `Stepper`,
  `DateField` (dual Gregorian/Ethiopian display).

**DoD:** a customer sees only their own data — verified by the cross-tenant probe suite _and_ by RLS
with the application-level filter deliberately removed in a test; the dashboard renders correctly
with zero data.

---

# Stage D — Operations

## Step 16 — Consignment spine and stock ledger

**Depends on:** 6, 9, 13.

**Do:**

- Migrations `0011_create_consignment_spine.sql` and `0012_create_stock_ledger.sql`.
- `src/modules/consignment/domain/` — `Consignment`, `Lot`, the lifecycle state machine, lineage,
  the derived-status rule (consignment status from its lots).
- Database trigger validating status transitions against `consignment_transition`.
- `src/modules/stock/` — the append-only ledger, `postMovements(tx, movements)` with balance
  projection upsert, transfer (two rows, one correlation id), adjustment with mandatory reason,
  physical count with variance, `stockByCustomer` / `stockByLocation` queries.
- Partition `stock_movement` by month.
- Worker handler: balance reconciliation.
- `src/app/(staff)/consignments/` — list, detail with the coffee-passport timeline.
- `src/app/(staff)/stock/` — ledger view, transfers, adjustments, counts. Documents: store transfer
  note, stock card.

**DoD:** the property test in
[../architecture/08-testing.md](../architecture/08-testing.md) #11 passes over randomised operation
sequences; no movement can be inserted without a location; the balance can be dropped and rebuilt
from the ledger to an identical state; the exhaustive transition test passes.

**This is the most important step in the project.** Do not compress it.

---

## Step 17 — Inbound delivery and goods receiving (M11)

**Depends on:** 13, 14, 16, 12.

**Do:**

- Migration `0013_create_inbound_tables.sql`.
- `src/modules/inbound/domain/` — delivery request rules, receiving rules, weighing rules
  (witness), kesha confirmation, `ApprovalPolicy` port + `StaticApprovalPolicy`
  ([../architecture/07-extension-points.md](../architecture/07-extension-points.md) Seam 3).
- Use cases: `submitDeliveryRequest` (portal), `checkCapacityForRequest`, `approveDeliveryRequest`
  (reserves capacity, emits), `rejectDeliveryRequest` (mandatory comment), `createGoodsReceipt`,
  `recordWeighing`, `confirmKeshaCount`, `placeInStore`.
- Portal: `src/app/(portal)/delivery-requests/`.
- Staff: `src/app/(staff)/delivery-requests/`, `src/app/(staff)/receiving/` — **mobile-responsive**,
  large touch targets, because this is used at the unloading bay.
- Documents: delivery request acknowledgement, delivery request approval, GRN, Weight & Kesha List,
  store placement slip, bag/lot labels with QR.

**DoD:** no coffee can be received without an approved delivery request (the M11 key control); a
request cannot be approved without a satisfied capacity check; every receipt records kg **and**
kesha with the average shown; placement consumes the reservation; `ConsignmentReceived` and
`KeshaCountConfirmed` are emitted; the customer is notified.

---

## Step 18 — Appointment and production scheduling (M14)

**Depends on:** 16, 17, 11.

**Do:**

- Migration `0015_create_scheduling_tables.sql` including the appointment `EXCLUDE USING gist`
  no-overlap constraint.
- `src/modules/scheduling/domain/` — eligibility specifications (lots in store; not already
  committed; customer not on hold via `CustomerHoldPolicy`), slot allocation, the delay-cascade
  rule.
- Use cases: `submitProcessingRequest` (portal), `validateEligibility`, `scheduleAppointment`,
  `rescheduleAppointment` (records reason + category, **cascades onto downstream jobs, notifies
  every affected customer**), `cancelAppointment`.
- Portal: `processing-requests/`, `appointments/`.
- Staff: `src/app/(staff)/scheduling/` — calendar by production line, drag-to-reschedule with a
  mandatory reason, the cascade preview before confirming.
- Document: appointment confirmation.

**DoD:** a request for lots not physically in store is refused (the M14 key control); a reschedule
cascades and every affected customer receives a delay notification with the new date and the reason
— this is the Stage 3 requirement and the most visible feature in the module; concurrent bookings on
one line cannot overlap.

---

## Step 19 — Processing execution and output classification (M15)

**Depends on:** 16, 18.

**Do:**

- Migration `0016_create_processing_tables.sql`.
- `src/modules/processing/domain/` — `JobOrder`, `MassBalance`, yield calculation, the
  four-way output rule, the close guard.
- Use cases: `acceptJob` (operator), `startJob` (timestamped; refuses to start before the scheduled
  window without `job_order:override_schedule`), `issueLotsToJob`, `recordOutput` (per
  classification: weight, kesha, bag type, destination location), `recordLoss` (categorised),
  `closeJob` (mass balance within tolerance, or explained with the higher permission).
- Staff: `src/app/(staff)/processing/` — a job execution screen designed for the line: big numbers,
  live running mass balance, immediate variance feedback.
- Documents: job order, processing completion report, yield & mass-balance statement, output lot
  labels.

**DoD:** a job cannot close while the mass balance is outside tolerance and unexplained (the M15 key
control); the signed ledger sum over the job's correlation id is exactly zero; output lots exist with
lineage to the parent; yields are snapshotted at close; the consignment moves to `PROCESSED`.

---

## Step 20 — Customer acceptance and Mirt Merekebiya (M16)

**Depends on:** 19, 10, 12.

**Do:**

- Migration `0017_create_acceptance_tables.sql`.
- `src/modules/acceptance/` — acceptance pack assembly (input weight, four outputs with weight and
  kesha, yield percentages, process loss, storage location), Mirt Merekebiya generation with a
  unique number and both signature blocks, signature capture with `method`
  (`PORTAL_CLICK` | `WET_INK_SCAN`), identity, timestamp and IP.
- Portal: `src/app/(portal)/acceptances/[id]` — review the pack and accept.
- Staff: `src/app/(staff)/acceptance/` — pending list, issue pack, record a wet-ink signature by
  scanning and attaching.
- Document: Mirt Merekebiya.

**DoD:** both signature routes produce the same auditable outcome; the consignment moves to
`ACCEPTED_BY_CUSTOMER`; coffee cannot be dispatched without acceptance (asserted from the dispatch
side in Step 21); the document reproduces exactly the figures presented.

---

## Step 21 — Outbound dispatch, gate pass and delivery (M17)

**Depends on:** 16, 20.

**Do:**

- Migration `0018_create_dispatch_tables.sql` (`transporter`, `vehicle`, `driver`,
  `release_request`, `dispatch`, `gate_pass`, `gate_event`).
- `src/modules/dispatch/` — release request (accepted lots only), clearance checks
  (`CustomerHoldPolicy` — document compliance in Phase 1, financial hold added in Phase 2), dispatch
  scheduling, loading, gate pass issue (numbered, QR-tokenised, single-use), gate-out recording
  which **deducts stock at the moment of departure** and closes the consignment.
- Portal: `src/app/(portal)/release-requests/`.
- Staff: `src/app/(staff)/dispatch/` and `src/app/(staff)/gate/` — the gate screen is
  scan-first, mobile, and usable one-handed.
- Documents: picking & loading list, delivery/dispatch note, gate pass.

**DoD:** no dispatch without recorded acceptance (the M17 key control); a gate pass cannot be used
twice (enforced by a status transition inside a transaction, not by a check-then-act); stock is
deducted at gate-out, not at loading; the consignment closes; returnable customer-owned bags are
listed on the loading document.

---

# Stage E — Support and hardening

## Step 22 — Kesha management and labour (M13, M18)

**Depends on:** 17, 19, 21.

**Do:**

- Migrations `0014_create_kesha_tables.sql`, `0019_create_labour_tables.sql` (with
  `piece_rate_version` and its no-overlap exclusion constraint).
- `src/modules/kesha/` — empty-bag inventory with receipt/issue/balance, customer-owned bag tracking
  with returnable flags, the reconciliation identity, condemnation with reason.
- `src/modules/labour/` — gangs, workers, memberships, effective-dated piece rates by activity ×
  weight class × shift with overtime/night/holiday multipliers, earnings calculation with both split
  methods, vouchers.
- **`labour_activity.kesha_count` is written only by event handlers** — no UI input exists, anywhere
  (the M18 key control, made structural).
- Staff UI for both; document: labour payment voucher.

**DoD:** a labour quantity cannot be entered by hand — verified by a test asserting no write path to
`kesha_count` outside the handlers; bag reconciliation refuses to close with an unexplained variance;
re-running an old voucher reproduces the original amount from the stored rate version.

---

## Step 23 — System administration and support desk (M23)

**Depends on:** all.

**Do:**

- Migration `0020_create_administration_tables.sql` (settings, feature flags, support desk).
- `src/modules/administration/` — settings console generated from `settings.schema.ts` with
  old→new value auditing, numbering-series configuration, feature flags, user/role management UI,
  a minimal support-desk ticket model, system health view.
- Governance views: user access & dormant account review, approval turnaround, stock adjustment
  audit, exception register, configuration change history — the "Governance" items in the client
  document's report library §7.2.
- `src/app/(staff)/admin/`.

**DoD:** every setting is editable by an authorised administrator without a deploy and every change
is audited with the old and new value (the M23 key control); dormant accounts are listed; the
exception register aggregates mass-balance, capacity, bag and adjustment exceptions.

---

## Step 24 — Hardening, performance, UAT

**Depends on:** all.

**Do:**

- Migrations `…_0021_enable_rls_policies.sql` and `…_0022_create_reporting_views.sql`.
- **Enable and `FORCE` RLS on every table in `public`** — not only the customer-scoped ones. A table
  with RLS off is readable by anyone holding the anon key. Add a CI check that fails on any
  `public` table lacking a policy.
- Run the isolation suite against the **Supavisor transaction pooler**, not a direct connection —
  the leak this test exists to catch only manifests under pooling.
- Audit every `withServiceDb` import site against the allow-list and justify each in writing.
- Verify no `NEXT_PUBLIC_*` variable and no built client bundle contains the service-role key.
- **Confirm the hosted-vs-self-hosted decision** ([adr/0013](../adr/0013-supabase-as-database-platform.md))
  with measured latency and link-reliability data from the plant; write `supabase-outage.md`.
- Verify PITR is enabled, and that the independent off-platform dump **and** the Storage bucket
  backup both restore together.
- Full security pass against the threat register in
  [../architecture/05-security.md §5.7](../architecture/05-security.md): cross-tenant probe suite,
  dependency audit, secret scan, CSP verification in a real browser, penetration test if budget
  allows.
- Load test the two hot paths (portal stock view, receiving flow) with `k6` at harvest-peak
  concurrency; add indexes from `pg_stat_statements`, not from guesswork.
- Accessibility pass with `axe` on the four journeys; verify the gate and receiving screens on a
  cheap tablet in bright light.
- Complete the Amharic translation pass and verify Ethiopic rendering in every PDF.
- Write the eight runbooks; execute a restore drill and record the time.
- Seed a full demo season; run UAT with Operations, Store and Finance against Stages 1–4.
- Train users; produce role-based quick-reference cards.

**DoD:** the ten items in [scope.md](scope.md) "Definition of done for Phase 1" are all true.

---

## Sequencing notes

**Can run in parallel** once Step 8 is done:

- Steps 9 (master data) and 10 (files) — independent.
- Steps 11 (notifications) and 12 (printing) — independent of each other.
- Step 13 (warehouse) alongside 14 (onboarding).
- Steps 22 (kesha/labour) and 23 (administration) alongside 20–21.

**Cannot be parallelised, and attempts will hurt:** Step 16. The consignment spine and the stock
ledger are the substrate for 17–21; starting those before 16 is stable produces rework in five
modules simultaneously.

**Vertical slice option.** If early stakeholder feedback matters more than sequencing purity, insert
a thin end-to-end slice after Step 12: one customer, one delivery request, one receipt, one
placement — real code in the real architecture, no shortcuts, deliberately narrow. It de-risks the
architecture and gives EthioStar something to react to five weeks in. Do **not** implement it by
skipping layers; a slice that cheats teaches the wrong lesson and has to be rewritten.

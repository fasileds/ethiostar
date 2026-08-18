# 6. Cross-Cutting Concerns

Configuration, errors, logging, transactions, jobs, notifications, printing, i18n, files. These are
built once, early, and every module uses them. Building them late means retrofitting eighteen
modules.

---

## 6.1 Configuration

### Two kinds, kept apart

|                 | Environment (`src/config/env.ts`)                                                   | Runtime settings (`system_setting`, M23)                                                       |
| --------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Examples        | `DATABASE_URL`, `SMTP_HOST`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | mass-balance tolerance, safe-fill %, free storage days, approval thresholds, numbering formats |
| Changed by      | Ops, via deployment                                                                 | An authorised administrator, in the UI                                                         |
| Requires deploy | Yes                                                                                 | No                                                                                             |
| Audited         | Deployment record                                                                   | `system_setting_history` — old value, new value, who, when                                     |

Conflating them is the mistake that forces a developer into the room every time a business number
changes — which M23 exists to prevent.

### `env.ts`

```ts
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  APP_URL: z.string().url(),

  // Supabase — pooled (6543) for the app, direct for migrations only
  DATABASE_URL: z.string().url(), // Supavisor transaction pooler, port 6543
  DIRECT_URL: z.string().url(), // direct 5432 — migrations + drizzle-kit only
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20), // SERVER ONLY. Bypasses RLS. Never NEXT_PUBLIC_.

  NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
  SMTP_HOST: z.string(),
  SMTP_PORT: z.coerce.number(),
  SMTP_USER: z.string(),
  SMTP_PASSWORD: z.string(),
  MAIL_FROM: z.string().email(),
  SUPABASE_STORAGE_BUCKET: z.string().default('cpms-documents'),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  DEFAULT_LOCALE: z.enum(['en', 'am']).default('en'),
  TIME_ZONE: z.literal('UTC'),
})
export const env = serverSchema.parse(process.env) // throws at boot on a bad config
```

Two production refusals worth encoding in the schema, because both are silent failures:

- `DATABASE_URL` must use port **6543** and the client must set `prepare: false` — the pooler
  reassigns connections between queries.
- `SUPABASE_SERVICE_ROLE_KEY` must not equal the anon key, and no `NEXT_PUBLIC_*` variable may
  contain it. CI also greps the built client bundle for the service-key pattern.

`SESSION_SECRET` is gone: GoTrue signs the JWTs now.

Called from `instrumentation.ts` so the process **fails to start** on misconfiguration rather than
failing on the first request that happens to need `SMTP_HOST`. In production the schema additionally
refuses insecure combinations (e.g. `NoopScanner` with `NODE_ENV=production`).

`process.env` appears in exactly one file. A lint rule (`no-restricted-properties`) enforces it.

### `settings.ts`

Typed, cached (60s TTL, invalidated on write), namespaced:

```ts
await settings.get('processing.mass_balance_tolerance_pct') // → number, typed
await settings.get('warehouse.default_safe_fill_pct')
await settings.get('storage.free_days') // defined now, consumed by M20 (P2)
```

Each setting is declared in `settings.schema.ts` with a Zod type, default, description, unit, and
`editableByRole`. The admin UI is generated from that declaration, so adding a setting is one entry,
not a form.

---

## 6.2 Error handling

### The hierarchy

```
AppError (code, message, httpStatus, details?, cause?, isOperational)
├─ ValidationError          422  input failed schema or domain validation
├─ UnauthorizedError        401  no valid session
├─ ForbiddenError           403  authenticated but not permitted
├─ NotFoundError            404  (also returned instead of 403 for cross-tenant probes)
├─ ConflictError            409  unique violation, duplicate submission
├─ ConcurrencyError         409  optimistic lock failure — "someone else changed this"
├─ BusinessRuleViolation    422  the interesting one: mass balance, capacity, lifecycle, holds
├─ RateLimitedError         429
└─ InfrastructureError      500  DB, SMTP, S3, ClamAV unavailable — the only non-operational class
```

Every error carries a **stable machine-readable code** (`PROCESSING.MASS_BALANCE_OUT_OF_TOLERANCE`)
which is the i18n key and the thing the UI branches on. Never branch on a message string.

### Expected vs unexpected

- **Expected domain failures** are returned, not thrown: use cases return
  `Result<T, BusinessRuleViolation>`. "Capacity unavailable" is a normal Tuesday, not an exception,
  and a `try/catch` around business logic hides the cases you should be handling.
- **Programmer errors and infrastructure failures** are thrown and caught by the wrapper.

```ts
const result = await approveDeliveryRequest(input)
if (!result.ok) return actionError(result.error) // typed, localised, shown in the form
```

### Where errors are mapped

Only in `withAction()` and `withRoute()`. The domain and application layers never know about HTTP.

- Server Actions → `ActionResult<T> = { ok: true; data: T } | { ok: false; error: { code, message, fieldErrors? } }`.
  Returning failures instead of throwing keeps `useActionState` ergonomic and avoids the Next.js
  error overlay swallowing user-facing messages.
- Route handlers → RFC 9457 `application/problem+json`.
- **Never leak internals.** In production, an `InfrastructureError` becomes
  `{ code: 'INTERNAL', requestId }`. The request id is shown to the user and is the key to the log.

### UI boundaries

`error.tsx` per major route group (not one global boundary — a failure in the labour module should
not blank the whole staff shell), plus `global-error.tsx`. Next 16's `catchError()` from `next/error`
is used for component-level recovery inside long pages (for example, one failing widget on the
dashboard) because it integrates with `retry()` and does not accidentally swallow `redirect()` or
`notFound()`.

---

## 6.3 Transactions and unit of work

```ts
await unitOfWork.run(async (tx) => {
  await setTransactionContext(tx, actor) // app.actor_id, app.actor_kind, app.customer_id
  const receipt = await receiptRepo.load(tx, id)
  receipt.confirmKeshaCount(lines, actor, clock.now())
  await receiptRepo.save(tx, receipt)
  await stockLedger.post(tx, receipt.pullMovements())
  await eventStore.append(tx, receipt.pullEvents()) // domain_event + outbox, same tx
})
```

Rules:

1. **One transaction per use case.** Not per repository call. Repositories accept `tx`; they never
   open their own.
2. **The audit event and the business change share the transaction.** This is the property that
   makes the audit trail trustworthy.
3. **No I/O inside a transaction.** No email, no S3, no PDF, no HTTP. These go to the outbox and run
   after commit. A PDF render inside a transaction holds row locks for the duration of a Chromium
   startup — this is how a plant grinds to a halt.
4. **Isolation:** `READ COMMITTED` default. `REPEATABLE READ` with a retry loop (3 attempts,
   jittered backoff) for capacity reservation and stock counting, where phantom reads matter.
5. Long report queries run against a Supabase read replica when one exists, with a longer
   `statement_timeout`. Note that session timeouts are now GoTrue settings in `supabase/config.toml`,
   not runtime business settings.

---

## 6.4 Domain events, outbox, and the worker

### Transactional outbox

Writing to the database and publishing an event are one atomic act, or the system lies. Both rows go
in with the business change:

```
domain_event   the permanent, append-only record (audit + Phase 3 substrate)
outbox         the delivery queue: event_id, status, attempts, next_attempt_at, published_at
```

A relay in the worker claims outbox rows with `FOR UPDATE SKIP LOCKED`, dispatches to the registered
handlers, and marks them published. Handlers must be **idempotent** — at-least-once delivery is the
contract, and pretending otherwise produces duplicate emails.

### Job queue

```sql
job_queue (
  id, job_type, payload jsonb, status PENDING|CLAIMED|DONE|FAILED|DEAD,
  priority int, run_after timestamptz, attempts int, max_attempts int default 5,
  claimed_by text, claimed_at timestamptz, last_error text,
  idempotency_key text UNIQUE,     -- enqueue-once semantics
  correlation_id uuid
)
```

Claim pattern:

```sql
UPDATE job_queue SET status='CLAIMED', claimed_by=$1, claimed_at=now()
WHERE id IN (
  SELECT id FROM job_queue
  WHERE status='PENDING' AND run_after <= now()
  ORDER BY priority, run_after
  FOR UPDATE SKIP LOCKED LIMIT $2
) RETURNING *;
```

`SKIP LOCKED` is what makes running several worker instances safe with no coordination service.
Exponential backoff with jitter; after `max_attempts` the job moves to `DEAD` and raises an alert
rather than disappearing.

**Recurring scans**: document expiry, capacity thresholds, ageing stock, reservation expiry, balance
reconciliation, appointment reminders.

Scheduling uses **`pg_cron`** (`supabase/migrations/…_create_scheduled_tasks.sql`). A cron entry only
_inserts a `job_queue` row_; the worker still executes it, so retry, backoff, dead-lettering and
idempotency are unchanged. This replaces the leader-election advisory lock — `pg_cron` fires once
regardless of how many workers run. On a Supabase plan without `pg_cron`, fall back to the
advisory-lock tick in `schedules.ts`; the handler code is identical either way.

Do not put job _logic_ in `pg_cron`. It is a scheduler, not a runner, and SQL-embedded business logic
is invisible to tests and to the type system.

Why not `after()`: it is right for fire-and-forget logging and wrong for anything the business must
prove happened. The M04 key control ("the log is an evidentiary record") requires durability.

---

## 6.5 Logging and observability

**pino**, structured JSON to stdout; the container platform ships it.

Every log line carries `requestId`, `correlationId`, `actorId`, `actorKind`, `module`, `useCase`,
`durationMs`. Context flows through `AsyncLocalStorage` (`core/observability/context.ts`), seeded by
`proxy.ts` and by the worker per job, so nothing has to thread a logger through call signatures.

Redaction is **allow-list based**: the serialiser emits known-safe fields only. Never logged:
passwords, tokens, session ids, TOTP secrets, bank account numbers, full file contents.

Levels, applied consistently:

- `error` — unexpected, needs a human. Paged.
- `warn` — expected-but-notable: authorization denial, mass-balance variance, capacity refusal,
  notification retry.
- `info` — business milestones: consignment received, job closed, gate pass issued.
- `debug` — development only.

**OpenTelemetry** via `instrumentation.ts` (`register()`), traces on HTTP, database and job spans.
Metrics worth having from day one, because they are the questions you will be asked:

```
cpms_consignment_transition_total{from,to}
cpms_stock_movement_total{movement_type}
cpms_mass_balance_variance_pct         histogram
cpms_capacity_check_total{result}
cpms_notification_total{template,status}
cpms_job_queue_depth{job_type,status}
cpms_outbox_lag_seconds
cpms_authz_denied_total{permission}
cpms_document_printed_total{series}
```

`cpms_outbox_lag_seconds` is the one to alert on: it is the earliest signal that customers have
stopped being notified.

---

## 6.6 Notifications (M04)

```
notification_template   code, channel, locale, subject, body (handlebars-ish), version, is_active
notification            id, template_code, channel, recipient, subject, body_rendered,
                        entity_type, entity_id, status, created_at, sent_at, actor_id, locale
notification_delivery_attempt   notification_id, attempt_no, attempted_at, result, provider_response
```

- **Append-only. Nothing is ever deleted** — the M04 key control. Cancelling means status
  `CANCELLED`, not a `DELETE`.
- The **rendered** body is stored, not just the template reference. When a customer says "you never
  told me about the delay", the answer must be the exact text sent, not a template that has since
  been edited.
- Channel is a port: `EmailChannel` in Phase 1; `SmsChannel`, `PushChannel`, `InAppChannel` slot in
  without touching any caller.
- Templates are seeded from files and editable in the admin console; edits create a new
  `version` rather than mutating.
- Every event trigger listed in the document (application received/approved/rejected, document
  expiring, delivery request approved, coffee received, storage confirmed, appointment
  scheduled/changed/delayed, processing started/completed, output ready, Mirt Merekebiya awaiting
  signature, dispatch scheduled, gate pass issued) maps to one template code. Invoice/payment
  triggers are defined but unwired — M19 is Phase 2.
- Digest/quiet-hours support via `notification_preference`, so a scheduler is not woken sixty times.

---

## 6.7 Printing, labelling and QR (M06)

This module _"is what makes the system visible on the factory floor"_, and it is routinely
underestimated. Budget for it.

### Rendering

`DocumentRenderer` port; Phase 1 implementation uses `@react-pdf/renderer`. Chosen over headless
Chromium because it needs no browser binary in the container, has predictable memory, and renders
Ethiopic script correctly once the font is embedded. The port exists precisely so this can be
revisited without touching call sites.

```
platform/pdf/
├─ renderer.ts              implements DocumentRenderer
├─ primitives/              Letterhead, Footer (number + timestamp + printed-by), SignatureBlock,
│                           DataTable, WatermarkDuplicate, QrBlock
└─ fonts/                   Latin + Ethiopic (Noto Sans Ethiopic), embedded
```

### The Phase 1 document set

Delivery request acknowledgement · delivery request approval · Goods Receiving Note · Weight & Kesha
List · store placement slip · store transfer note · stock card · appointment confirmation · job
order · processing completion report · yield & mass-balance statement · Mirt Merekebiya · picking &
loading list · delivery/dispatch note · gate pass · labour payment voucher · application
acknowledgement · registration certificate & credential letter · bag/lot labels and hanging tags.

(Proforma invoice, tax invoice, receipt and account statement are M19 — Phase 2. The renderer and
numbering series accommodate them with no change.)

### Controls, all mandatory

- Every render allocates a number from `document_number_series` (§4.7) and writes a
  `printed_document` row with actor, timestamp, locale and a SHA-256 of the payload snapshot.
- Reprints increment `copy_number` and stamp **DUPLICATE**.
- The payload snapshot means a document reprinted a year later shows the figures as they were, not
  as master data has since become.
- Rendering happens **outside** the business transaction, driven by the outbox.

### Labels and QR

- Label sizes configurable (default 100×150 mm thermal, plus A4 sheet layout for laser).
- Content per the document: customer name, consignment number, lot number, coffee type, grade, net
  weight, kesha count, room/section, processing date.
- QR encodes `{APP_URL}/api/v1/scan/{token}` where `token` is a random 128-bit value in `qr_token`,
  **not** the lot id. This keeps ids unguessable, lets a token be revoked if a label is compromised,
  and lets the same physical lot carry a new token after re-bagging.
- Scanning resolves to the coffee passport, scoped to the scanning user's permissions. An
  unauthenticated scan shows only "this label is valid, log in to see details" — enough to verify a
  label is genuine, not enough to leak a customer's position.

---

## 6.8 Files (the M05 seam)

Phase 1 needs KYC document upload (M08), scanned Mirt Merekebiya (M16) and dispatch authorisations
(M17). Full document management with e-signature is M05, Phase 2.

**Backed by Supabase Storage**, behind the existing `FileStorage` port. Rules:

- **All buckets private.** No public bucket, ever — a public bucket makes every customer document
  world-readable by URL.
- Downloads go through our own route handler, which authorizes the actor and then issues a
  **short-lived signed URL** (60 s). The client never talks to Storage directly.
- RLS policies on `storage.objects` mirror the `stored_file` policies, so a leaked object path is
  still not enough.
- **Virus scanning stays ours.** Supabase does not scan uploads. The upload handler writes
  `scan_status = 'PENDING'`, a worker job scans via ClamAV and updates it, and a `PENDING` or
  `INFECTED` file cannot be linked or downloaded. This is the M05 key control and it is honoured in
  Phase 1.
- Object key is `{entityType}/{uuid}/{sha256}` — never the uploaded filename.

The seam:

```
stored_file   id, storage_key, original_filename, mime_type, size_bytes, sha256,
              scan_status PENDING|CLEAN|INFECTED|ERROR, uploaded_by, uploaded_at,
              document_type_id, expires_on, is_current, superseded_by_id
file_link     file_id, entity_type, entity_id, link_role, created_by, created_at
```

`file_link` being polymorphic is deliberate: it is what lets M05 attach documents to invoices and
contracts in Phase 2 without a new table or a migration of existing links. `expires_on` and
`is_current` exist now because M08's key control (an application cannot be approved with an expired
document) needs them, and the same fields power M05's expiry reminders later.

---

## 6.9 Internationalisation

- Locales `en` and `am`. Messages in `core/i18n/messages/`. All master data carries `name_en` and
  `name_am`.
- **Documents render in the recipient's locale.** A Mirt Merekebiya a customer signs should be
  readable by that customer; the locale is stored on `printed_document` so a reprint matches.
- **Ethiopian calendar** conversion for display and printed documents
  (`core/i18n/ethiopian-calendar.ts`). Storage is always UTC `timestamptz`; conversion is a
  presentation concern. Getting this backwards — storing Ethiopian dates — is unrecoverable.
- Business day boundaries use `Africa/Addis_Ababa`. "Coffee received today" and dwell-time
  calculations must use the plant's day, not UTC's. `core/utils/date.ts` owns this; nothing else
  computes a business date.
- Number formatting: Ethiopic digits are not used for quantities; ETB formatting is centralised.

---

## 6.10 The wrappers

Every entry point goes through one of these. They are what makes the cross-cutting concerns actually
apply, rather than being nineteen things each developer must remember.

```ts
// src/server/actions/with-action.ts
export function withAction<TIn, TOut>(config: {
  name: string
  permission: PermissionCode | 'public'
  schema: ZodSchema<TIn>
  rateLimit?: RateLimitConfig
  handler: (input: TIn, ctx: ActionContext) => Promise<Result<TOut, AppError>>
}): (formDataOrInput: unknown) => Promise<ActionResult<TOut>>
```

It establishes the request context, resolves the actor, applies the rate limit, parses and validates
input, calls `requirePermission` (or requires the explicit `'public'` declaration), invokes the
handler, maps errors, logs with timing, and emits metrics.

`withRoute()` does the same for route handlers, adding content negotiation, idempotency-key handling
and problem+json output.

The result: a use case is business logic and nothing else, and no developer can forget the
cross-cutting parts, because there is no path that skips them.

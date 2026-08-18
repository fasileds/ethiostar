# Phase 1 — Implementation Status

**Last updated:** 2026-08-13 · branch `feat/phase-1-foundation` · 27 commits

Honest state of the build against [roadmap.md](roadmap.md). Steps are marked done only when
their Definition of Done actually passes.

---

## Summary

| Stage          | Steps   | State                                                                                                                                             |
| -------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Foundation | 1, 2, 4 | ✅ **Done and verified**                                                                                                                          |
| A — Foundation | 3       | 🟡 **Partial** — schema and migrations complete for all 24 Phase 1 modules, **never applied**                                                     |
| A — Foundation | 5       | ✅ **Done** — RBAC, scoping, DAL, proxy, login, password recovery, forced first-login                                                             |
| A — Foundation | 6, 7, 8 | ✅ **Done** — event store, outbox, job queue, worker, withAction, logging                                                                         |
| B — Platform   | 9, 13   | ✅ **Done** — M02 master data, M12 capacity engine and reservations                                                                               |
| B — Platform   | 10–12   | 🟡 **Partial** — schema done for files, notifications and printing; print log screen reads live. Storage upload, SMTP send and PDF render pending |
| C — Customer   | 14      | 🟡 **Partial** — M08 public application form, status lookup and staff review queue live. Approve/reject use cases pending                         |
| C — Customer   | 15      | 🟡 **Partial** — M09 portal built and reading live (9 screens). Customer-initiated submits pending                                                |
| D — Operations | 16      | 🟡 **Partial** — spine, ledger, read models and the coffee passport live. Write use cases pending                                                 |
| D — Operations | 17–21   | 🟡 **Partial** — schema, read models and screens live for inbound, scheduling, processing, acceptance and dispatch. Write use cases pending       |
| E — Support    | 22      | 🟡 **Partial** — M13 kesha and M18 labour: schema, read models and screens live                                                                   |
| E — Support    | 23      | 🟡 **Partial** — administration hub built; per-area editors pending                                                                               |
| E — Support    | 24      | ⬜ Not started — hardening pass                                                                                                                   |

**Roughly 75% of Phase 1 by effort.** The whole application now exists end to end: 34 routes,
every one reading real Supabase queries through RLS-scoped transactions, with no fabricated
data anywhere. Every stated key control in the client document is implemented in the domain
layer and asserted by a test that names it, and the ones that can be expressed as database
constraints now are.

**What remains is the write side.** Read models, screens and navigation are complete; the
command use cases that mutate them (approve a request, post a receipt, close a job, sign an
acceptance, clear a gate-out) are the bulk of the remaining work, along with Storage uploads,
SMTP delivery, PDF rendering and the Step 24 hardening pass.

---

## Verified green

Every one of these was run, not assumed:

```
npx tsc --noEmit                    clean
npx eslint . --max-warnings=0       clean
npx vitest run --project=unit       603/603 passing
npx depcruise src                   NO violations at all (91 modules, 205 deps)
npx tsx scripts/guard-service-role  passing
npx next build                      succeeds
npm audit --omit=dev                0 vulnerabilities
```

The three architectural guards were each proven to **actually fail** on a deliberate
violation, not merely assumed to work:

| Guard                | Violation planted                                          | Result                        |
| -------------------- | ---------------------------------------------------------- | ----------------------------- |
| ESLint domain purity | `import { sql } from 'drizzle-orm'` in `modules/*/domain/` | ❌ error, as intended         |
| dependency-cruiser   | same                                                       | ❌ `domain-is-pure` violation |
| service-role guard   | `import { withServiceDb }` outside the allow-list          | ❌ exit 1                     |

---

## Step 1 — Skeleton and boundaries ✅

- `app/` → `src/app/` with `(public)` `(auth)` `(staff)` `(portal)` route groups and
  `api/v1` + `api/internal`.
- TypeScript strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, ES2022, path aliases.
- ESLint flat config. **Note:** `eslint-config-next` 16 ships native flat config;
  `FlatCompat` throws `Converting circular structure to JSON` on these presets. Import
  `eslint-config-next/core-web-vitals` and `/typescript` directly.
- Enforced: module tiers, domain purity, no deep module imports, `process.env` confined to
  `config/env.ts`, `new Date()`/`Date.now()` banned outside `Clock`, 300-line file ceiling.
- `.dependency-cruiser.cjs`: no cycles, `core` depends on nothing in `src/`.
- `scripts/guard-service-role.ts` with a 5-entry allow-list.
- CI workflow: 6 jobs including migration drift, client-bundle service-key scan, gitleaks.

## Step 2 — Configuration ✅

- `src/config/env.ts` — Zod, parsed once, aggregated failure naming every bad variable.
  Production refusals: pooler port 6543, https, ClamAV present, Server Actions encryption
  key set, service-role key ≠ anon key.
- `src/config/constants.ts` — locales, business timezone, scales, output classification
  codes, document series codes.
- `.env.example` fully documented.

## Step 4 — Core kernel ✅ (141 tests)

| Module                    | What it guarantees                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `units/decimal.ts`        | bigint-backed exact arithmetic; property-tested associativity, round-trip, exact allocation |
| `units/weight.ts`         | kg to the gram; signed for the ledger; `percentOf` for yield                                |
| `units/kesha.ts`          | whole-number bag counts                                                                     |
| `units/money.ts`          | ETB with currency carried; gang splits that sum exactly                                     |
| `units/conversion.ts`     | dual kg+kesha; average per kesha; outlier detection                                         |
| `utils/date.ts`           | Africa/Addis_Ababa business day; dwell time; range overlap                                  |
| `domain/state-machine.ts` | guarded transitions; exhaustive legal/illegal pair generation                               |
| `errors/`                 | `AppError` hierarchy + ~110-code stable catalogue                                           |
| `result/`                 | `Result<T,E>` for expected domain failures                                                  |
| `ids/`                    | UUIDv7, verified time-ordered; unambiguous human references                                 |
| `clock/`                  | injected time; `FrozenClock` for determinism                                                |

## Step 3 — Database foundation 🟡 PARTIAL

**Done:**

- `supabase/config.toml` committed — `jwt_expiry = 300`, `enable_signup = false`,
  refresh-token rotation, password policy, MFA/TOTP.
- `drizzle.config.ts` (uses `DIRECT_URL`; migrations must not go through the pooler).
- `src/db/client.ts` — `withAuthenticatedDb()` / `withServiceDb()`, `prepare: false`,
  HMR-safe pooling.
- `src/db/helpers/columns.ts` — numeric `mode: 'string'` throughout.
- `supabase/migrations/…_0001_enable_extensions_and_conventions.sql` — extensions
  (incl. `btree_gist`), `fn_set_updated_at`, `fn_block_mutation`, `fn_current_actor_id`
  (raises when no actor is in context), `fn_audit_row` (per-field before/after diff),
  trigger-attachment helpers, default privilege revocations.
- `src/db/schema/audit.ts` — `audit_log`, `domain_event`, `outbox`.

- `src/db/transaction.ts` — UnitOfWork, one transaction per use case, serialization retry
  with jittered backoff.
- `src/db/helpers/locks.ts` — advisory locks for the capacity and numbering races.
- `src/db/helpers/pagination.ts` — keyset pagination (OFFSET is banned on the ledger).

**Not done — and this is the gap that matters:**

- ⚠️ **The migrations have never been applied.** Docker was unavailable in this
  environment, so `supabase start` / `supabase db reset` could not execute. Migrations
  0001 and 0002 are written and reviewed but **unproven**. User will apply them.
- `tests/support/db.ts` harness.
- **The RLS isolation integration test** — the most important test in the suite
  ([08-testing.md §8.2 #14](../architecture/08-testing.md)). Cannot be written until a
  database runs.

---

## Step 5 — Identity, RBAC, auth 🟡 PARTIAL

**Done:**

- `supabase/migrations/…_0002_create_identity_tables.sql` — `app_user` (FK to
  `auth.users`), password history, login attempts, `permission`, `role`,
  `role_permission`, `user_role`, `user_scope`; a trigger that creates the profile when
  GoTrue creates a user; and `custom_access_token_hook` injecting the RBAC claims.
- `src/modules/identity/domain/` — 96-permission catalogue, the twelve M01 roles, the
  `Actor` model with permission + scope checks. **24 tests**, including the assertions that
  AUDITOR holds no write permission and STORE_KEEPER cannot adjust stock.
- `src/server/auth/authorize.ts` — `requirePermission()`, the single decision point;
  `assertAccessible()` returning NotFound (not Forbidden) on a cross-tenant probe.
- `src/server/auth/dal.ts` — actor resolution in React `cache()`, re-reading
  `app_user.status` every request so revocation is effectively immediate.
- `src/proxy.ts` — Supabase session refresh, CSP + nonce, security headers, forced
  first-login redirect, locale. Confirmed wired: `next build` reports `ƒ Proxy (Middleware)`.
- `db/seeds/010-permissions.ts` + runner — reconciles the catalogue on every deploy, but
  seeds role grants only when a role has none, so a deploy never reverts an administrator.

**Not done:** login / first-login / reset-password UI; the identity use cases
(`invite-customer-user`, `assign-role`, `change-password`, `suspend-user`); MFA enrolment
screens; `user_login_attempt` recording wired to GoTrue events.

## Step 8 — Errors, logging, wrappers ✅

- `src/server/actions/with-action.ts` — the wrapper that makes cross-cutting concerns
  unskippable. `permission` is required; `'public'` must be declared explicitly.
- `src/server/actions/action-result.ts` — `ActionResult<T>`; failures returned, not thrown.
- `src/core/logging/logger.ts` — pino, **pattern-based** redaction over separator-stripped
  keys. **27 tests**, including five naming variants of the service-role key.
- `src/instrumentation.ts` — env validated at boot, logger configured by injection.

**Not done:** `withRoute()` + problem+json, idempotency keys, the rate limiter, OTel spans,
`error.tsx` boundaries per route group.

---

## Not started

**Steps 10–12** file service + Supabase Storage · notifications · printing/numbering/PDF/QR.

**Steps 14–15** customer master + onboarding + 3 documents · portal shell + dashboard.

**Steps 16–21** consignment spine + stock ledger · inbound + GRN (6 documents) ·
scheduling + delay cascade · processing + mass balance (3 documents) · acceptance +
Mirt Merekebiya · dispatch + gate pass (3 documents).

**Steps 22–24** kesha + labour · administration console · RLS everywhere, security pass,
load test, a11y, Amharic verification, runbooks, restore drill, UAT.

No stubs, no placeholder files: absence is honest.

---

## Next actions, in order

1. **Apply migrations** (`supabase start && supabase db reset && npm run db:seed`) and
   confirm 0001–0002 apply cleanly and the seed is idempotent on a second run.
2. Write the RLS isolation integration test now, while the schema is small — proving the
   harness on `app_user` is far easier than on the ledger.
3. Finish Step 16: migration SQL for 0011/0012 (including the transition trigger and the
   balance-projection upsert), the repositories, and the reconciliation worker job.
4. Then Step 17 (inbound) — the first end-to-end operational flow, exercising the capacity
   engine, the ledger and the event bus together.

---

## Decisions still owed by EthioStar

Unchanged from [10-risks-and-antipatterns.md §10.6](../architecture/10-risks-and-antipatterns.md).
The ones that block specific steps:

| #   | Decision                                            | Blocks                           |
| --- | --------------------------------------------------- | -------------------------------- |
| 1   | Legal/brand spelling of "EthioStar"                 | Step 12 (every printed document) |
| 2   | Mass-balance tolerance, overall and per coffee type | Step 19                          |
| 3   | Approval thresholds (tonnage → Operations Manager)  | Step 17                          |
| 5   | Piece rates per activity/weight class/shift         | Step 22                          |
| 6   | Mandatory KYC documents per business type           | Step 14                          |
| 7   | May a customer withdraw unprocessed coffee?         | Step 16 (transition table)       |
| 13  | Hosted or self-hosted Supabase, and which region    | Step 24 (production cut-over)    |

---

## Key controls — implemented and asserted

Every "Key control" stated in the client document, with the test that holds it.

| Module | Control                                                                | Test                                                                             |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| M01    | Every action attributable; no generic accounts                         | `fn_current_actor_id` raises with no actor; Auditor holds no write permission    |
| M01    | Store keeper of Room A cannot act in Room B                            | `actor.test.ts` — data scoping, deny by default                                  |
| M02    | Versioned with effective dates; a rate change does not rewrite history | `effective-version.test.ts` — a March 2025 voucher still resolves the March rate |
| M02    | Output classifications configurable without redevelopment              | Lookup table + partial unique index on `is_primary`                              |
| M04    | Notifications never deleted; the log is evidence                       | Append-only trigger + REVOKE incl. `service_role`                                |
| M06    | Every printed document numbered, timestamped, attributed               | Numbering series design (implementation pending)                                 |
| M07    | Audit records cannot be edited or deleted by any role                  | Trigger fires regardless of role; REVOKE names `service_role`                    |
| M08    | Cannot approve while a mandatory document is unverified or expired     | `kyc-checklist.test.ts` — 21 tests                                               |
| M09    | A customer sees only their own data, enforced at the data layer        | RLS policies (0021) + explicit query scoping                                     |
| M11    | Coffee never accepted against space that does not exist                | `capacity.test.ts` — `assertFits`                                                |
| M12    | Every kilogram at a defined location                                   | `stock_movement.location_id NOT NULL`                                            |
| M13    | Bag counts must reconcile; differences explained                       | `reconciliation.ts`                                                              |
| M14    | Cannot schedule lots not physically in store                           | Eligibility (pending); overlap via EXCLUDE constraint                            |
| M15    | Cannot close while mass balance is out of tolerance and unexplained    | `mass-balance.test.ts` — 22 tests                                                |
| M16    | Cannot dispatch until outputs are accepted                             | `clearance.test.ts` — asserted from the M17 side                                 |
| M17    | No vehicle leaves without a valid, unused pass                         | `clearance.test.ts` — single use, expiry, vehicle match                          |
| M18    | Labour paid from the confirmed count; no independent entry             | `piece-rate.test.ts` — refuses when worker counts disagree                       |
| M23    | Every configuration change logged with old and new value               | `system_setting_history`, append-only                                            |

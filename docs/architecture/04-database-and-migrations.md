# 4. Database Design and Migration Strategy

**Supabase Postgres**, Drizzle ORM for typed queries and schema definition, **hand-reviewable SQL
migrations** applied by the Supabase CLI.

Supabase is Postgres, so the schema design below is standard Postgres and would port elsewhere. What
Supabase changes is the _role model_, _how identity reaches RLS_, _how migrations are run_, and
_connection pooling_. Those four things are covered in §4.0, §4.4, §4.6 and §4.10 respectively — read
§4.0 before anything else.

Why Drizzle rather than `supabase-js`/PostgREST: this schema needs append-only triggers, partial and
expression indexes, `EXCLUDE USING gist` for appointment overlap, recursive CTEs for lot lineage, and
partitioned append-only tables. PostgREST would become an escape hatch on every interesting query.
See [adr/0013](../adr/0013-supabase-as-database-platform.md) and
[adr/0002](../adr/0002-drizzle-over-prisma.md).

---

## 4.0 The Supabase role model — read this first

Supabase ships four roles that matter:

| Role            | Used by                              | RLS                       |
| --------------- | ------------------------------------ | ------------------------- |
| `anon`          | unauthenticated requests             | applies                   |
| `authenticated` | requests carrying a valid GoTrue JWT | applies                   |
| `service_role`  | privileged server-side access        | **bypasses RLS entirely** |
| `postgres`      | migrations, owner                    | bypasses RLS (owner)      |

**`service_role` bypassing RLS is the single most dangerous fact in this document.** A codebase that
reaches for it by default has RLS in name only. The rule, restated from
[adr/0013](../adr/0013-supabase-as-database-platform.md):

### The default path — authenticated, RLS enforced

Application requests run inside a transaction that reproduces exactly what PostgREST does:

```ts
// src/db/client.ts — the ONLY place this pattern exists
export async function withAuthenticatedDb<T>(
  claims: SupabaseJwtClaims,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true);
      select set_config('request.jwt.claim.sub', ${claims.sub}, true);
      select set_config('app.actor_id', ${claims.sub}, true);
      set local role authenticated;
    `)
    return fn(tx)
  })
}
```

`auth.uid()` and `auth.jwt()` then resolve correctly inside RLS policies, because that is precisely
what they read. `set local` and `set_config(..., true)` are **transaction-scoped**, which is what
makes this safe under Supavisor's transaction pooling — a connection returned to the pool carries
nothing from the previous request.

**Queries outside a transaction get no JWT context and are evaluated as anonymous.** That is a
failure mode worth internalising: it fails closed, but it fails confusingly.

### The privileged path — three sanctioned uses only

`withServiceDb()` lives in the same file, is **not exported from the module barrel**, and is used
only by:

1. migrations (Supabase CLI, as `postgres`),
2. the background worker (no user context — it sets `app.actor_id` to a system actor so the audit
   trigger still attributes writes),
3. an explicit `src/modules/*/infrastructure/system/` namespace for operations with genuinely no
   acting user (credential issue during approval, outbox relay, reconciliation).

Every call site in (3) is audited and reviewed. A CI grep asserts the number of import sites of
`withServiceDb` matches an allow-list; adding one is a deliberate, visible act.

---

## 4.1 Conventions

### Naming

| Object             | Rule                               | Example                            |
| ------------------ | ---------------------------------- | ---------------------------------- |
| Table              | `snake_case`, **singular**         | `goods_receipt`                    |
| Join table         | `<a>_<b>` alphabetical             | `role_permission`                  |
| Column             | `snake_case`                       | `confirmed_kesha_count`            |
| Foreign key column | `<referenced_table>_id`            | `consignment_id`                   |
| Primary key        | always `id`                        |                                    |
| Boolean            | `is_` / `has_` prefix              | `is_active`, `has_variance`        |
| Timestamp          | `_at` suffix, always `timestamptz` | `received_at`                      |
| Date (no time)     | `_on` suffix, `date`               | `performed_on`                     |
| Quantity           | `_kg`, `_count`, `_pct` suffix     | `quantity_kg`, `kesha_count`       |
| Money              | `_amount` + sibling `currency`     | `gross_amount`, `currency`         |
| Index              | `idx_<table>__<cols>`              | `idx_stock_movement__lot_occurred` |
| Unique index       | `uq_<table>__<cols>`               | `uq_customer__tin`                 |
| Check constraint   | `ck_<table>__<rule>`               | `ck_stock_balance__non_negative`   |
| Foreign key        | `fk_<table>__<ref>`                | `fk_lot__consignment`              |
| Trigger            | `trg_<table>__<purpose>`           | `trg_audit_log__block_update`      |
| Function           | `fn_<purpose>`                     | `fn_set_updated_at`                |
| View               | `vw_<subject>`                     | `vw_stock_on_hand`                 |
| Materialized view  | `mv_<subject>`                     | `mv_room_occupancy`                |

Singular table names because the ORM entity is singular and the mismatch is a permanent small tax.
Pick one and never revisit it.

### Standard columns

Every business table gets:

```sql
id           uuid        PRIMARY KEY DEFAULT uuidv7()
created_at   timestamptz NOT NULL DEFAULT now()
created_by   uuid        NOT NULL REFERENCES app_user(id)
updated_at   timestamptz NOT NULL DEFAULT now()   -- maintained by trg_<t>__set_updated_at
updated_by   uuid            NULL REFERENCES app_user(id)
version      integer     NOT NULL DEFAULT 0       -- optimistic concurrency
```

Append-only tables (`stock_movement`, `domain_event`, `audit_log`, `notification`,
`printed_document`, `*_status_history`) omit `updated_*` and `version` — they cannot be updated, and
having the columns invites someone to try.

- **UUIDv7**, generated in the application via the `IdGenerator` port. Supabase Postgres does not
  expose a native `uuidv7()`, so do not depend on one; `gen_random_uuid()` (v4) is the database-side
  default only for tables the application never inserts into. Time-ordered UUIDs keep B-tree inserts
  local, avoiding the index fragmentation of UUIDv4 at scale, while remaining unguessable — which
  matters because IDs appear in URLs a customer can see.
- **`app_user.id` is a FK to `auth.users.id`**, which GoTrue generates as a UUIDv4. That is fine and
  is not ours to change; every _other_ table uses application-generated UUIDv7.
- **`version`** enables optimistic concurrency: `UPDATE … WHERE id = $1 AND version = $2`;
  zero rows affected → `ConcurrencyError` → the UI tells the user someone else changed the record.
  Two store keepers editing one GRN is a real Tuesday.

### Types — the rules that prevent silent corruption

| Concept         | Type                                           | Never                                                  |
| --------------- | ---------------------------------------------- | ------------------------------------------------------ |
| Weight (kg)     | `numeric(14,3)`                                | `float`/`double precision`/`real`                      |
| Kesha count     | `integer` with `CHECK (>= 0)` where applicable | `numeric`                                              |
| Percentage      | `numeric(6,3)`                                 | float                                                  |
| Money           | `numeric(14,2)` + `currency char(3)`           | float, or a bare number without currency               |
| Timestamp       | `timestamptz`                                  | `timestamp` (no zone)                                  |
| Business date   | `date`                                         | timestamptz truncated in application code              |
| Text            | `text` (+ `CHECK (length(…))`)                 | `varchar(n)` — changing `n` is a migration for nothing |
| Email           | `citext`                                       | `text` with `lower()` scattered around                 |
| Structured blob | `jsonb`                                        | `json`, or a text column with JSON in it               |

**Floats are banned for any business quantity.** `0.1 + 0.2 ≠ 0.3` becomes an unexplainable
mass-balance variance. The `pg` driver returns `numeric` as a _string_; the repository mapper parses
it into the `Weight`/`Money` value objects and never into a JS `number`. Drizzle's numeric mode must
be left as string — this is configured once in `db/helpers/columns.ts` and enforced by using only
those column builders.

### Enums: lookup tables, not `CREATE TYPE`

| Kind of value                                                                                                                    | Representation                                                                                 | Why                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Business-configurable (output classification, bag type, coffee type, reason codes, delay causes, document types, activity types) | **lookup table** with `code`, `name_en`, `name_am`, `sort_order`, `is_active`, effective dates | The document requires additions "without redevelopment" (M02). Also: adding a row is not a migration |
| Closed technical set (consignment status, movement type, notification channel, job status)                                       | Postgres enum **or** `text` + `CHECK`                                                          | Small, code-coupled, changes only with code                                                          |

Prefer `text` + `CHECK` over `CREATE TYPE` even for closed sets: altering a check constraint is a
cheap, reversible DDL, whereas removing an enum value requires recreating the type and rewriting
every dependent column. This looks like a small preference and is the difference between a
fifteen-minute Phase 2 migration and a day of downtime.

Lookup tables always carry a **stable `code`** that application code refers to. Never key logic on a
UUID or a display name — names get translated and re-spelled.

---

## 4.2 Effective-dated master data

M02 key control: _"Master data records are versioned with effective dates; changing a tariff does
not retrospectively alter invoices already raised under the old rate."_

Pattern, applied to `bag_type` standard weight, `piece_rate`, and (Phase 2) tariffs:

```sql
CREATE TABLE piece_rate (            -- the identity of the rate
  id uuid PRIMARY KEY,
  activity_type_id uuid NOT NULL REFERENCES labour_activity_type(id),
  bag_weight_class_id uuid REFERENCES bag_weight_class(id),
  shift_id uuid REFERENCES shift(id),
  is_active boolean NOT NULL DEFAULT true
  -- + standard columns
);

CREATE TABLE piece_rate_version (    -- what it was worth, when
  id uuid PRIMARY KEY,
  piece_rate_id uuid NOT NULL REFERENCES piece_rate(id),
  amount numeric(14,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'ETB',
  effective_from date NOT NULL,
  effective_to   date,                        -- NULL = open ended
  overtime_multiplier numeric(5,3) NOT NULL DEFAULT 1,
  night_multiplier    numeric(5,3) NOT NULL DEFAULT 1,
  holiday_multiplier  numeric(5,3) NOT NULL DEFAULT 1,
  CONSTRAINT ck_piece_rate_version__range CHECK (effective_to IS NULL OR effective_to > effective_from),
  EXCLUDE USING gist (
    piece_rate_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )   -- no two versions of one rate may overlap in time. Enforced by the database.
);
```

The `EXCLUDE` constraint is the point. Overlapping effective dates are the classic source of
"why was this priced at the old rate?", and application-level checks race. Requires
`CREATE EXTENSION btree_gist`.

Transactions **store the version id they used** (`labour_activity.piece_rate_version_id`), so
re-printing a six-month-old voucher reproduces the original figure exactly.

---

## 4.3 Append-only enforcement

M07 key control: _"Audit records cannot be edited or deleted by any role."_ A convention is not
enforcement.

```sql
CREATE OR REPLACE FUNCTION fn_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (attempted %)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log__append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION fn_block_mutation();

-- Belt and braces: no grant to begin with, for either application role.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM authenticated, anon, service_role;
```

Applied to: `audit_log`, `domain_event`, `stock_movement`, `notification`,
`notification_delivery_attempt`, `printed_document`, every `*_status_history` table, and
`gate_event`.

**The trigger matters more under Supabase than it would elsewhere.** `service_role` bypasses RLS, so
RLS alone would not stop a privileged path from rewriting history — but a `BEFORE UPDATE` trigger
fires regardless of role, and the `REVOKE` covers `service_role` explicitly. This is why the append-
only tables get both mechanisms rather than relying on grants.

Only `postgres` (migrations) can drop these triggers, and migrations are reviewed. A CI check asserts
that no migration touches an append-only table's triggers or grants without an explicit
`-- allow-audit-ddl` marker and a reviewer sign-off.

---

## 4.4 Row-Level Security

M09 key control: _"A customer sees only their own data, enforced at the data layer."_ The document
says _data layer_, and it means it. Under Supabase this is native, keyed on the GoTrue JWT.

```sql
ALTER TABLE consignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment FORCE ROW LEVEL SECURITY;   -- applies to the owner too

-- Staff: any authenticated user whose realm claim is 'staff'.
-- Fine-grained staff scoping (branch/warehouse/room) is done in the application,
-- because expressing it here would duplicate the scope resolver in SQL.
CREATE POLICY p_consignment__staff ON consignment
  FOR ALL TO authenticated
  USING ((auth.jwt() ->> 'actor_kind') = 'staff');

-- Customer: their own rows only.
CREATE POLICY p_consignment__customer ON consignment
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() ->> 'actor_kind') = 'customer'
    AND customer_id = (auth.jwt() ->> 'customer_id')::uuid
  );
```

`actor_kind` and `customer_id` are custom claims injected by the Custom Access Token hook
([adr/0014](../adr/0014-supabase-auth.md)). Using a claim rather than a join to `app_user` keeps the
policy a constant-time expression, which matters because it runs on every row of every query.

**Three things that will bite if forgotten:**

1. **`FORCE ROW LEVEL SECURITY`** — without it, the table owner (`postgres`) is exempt. With
   Supabase's role model that is a wider hole than it sounds.
2. **`service_role` is exempt regardless.** No policy can constrain it. This is why §4.0 confines it
   to three uses; RLS is not a substitute for that discipline.
3. **The claims must be set inside the transaction** (§4.0). A query outside one evaluates as
   anonymous and silently returns nothing — which reads like a bug in the query, not a missing
   context.

Policies are declared beside the tables using Drizzle's `pgPolicy` with the built-in
`authenticatedRole` / `anonRole` / `serviceRole` identifiers, so a new table's policy is written in
the same file as its columns rather than in a distant migration.

RLS remains **defence in depth, not the primary mechanism.** The primary mechanism is the application
scoping every customer query explicitly. RLS is what saves you the day someone forgets. Both, always
— and under Supabase, with the added rule that the privileged path is narrow and audited.

**Test coverage:** a dedicated integration test runs two interleaved transactions on one pooled
connection and asserts that customer A's claims never leak into customer B's transaction, plus a test
that deliberately removes the application-level filter and confirms RLS still isolates.

Tables with customer-scoped RLS: `customer`, `customer_document`, `consignment`, `lot`,
`delivery_request`, `goods_receipt`, `stock_balance`, `stock_movement`, `processing_request`,
`appointment`, `job_order`, `acceptance`, `release_request`, `dispatch`, `gate_pass`,
`notification`, `stored_file`, `printed_document`.

---

## 4.5 Table catalogue (Phase 1)

Roughly 95 tables. Grouped by migration file.

**0001 — extensions & conventions**
`pgcrypto`, `citext`, `btree_gist`, `pg_trgm`, `pg_cron`; `fn_set_updated_at`, `fn_block_mutation`,
`fn_audit_row` (generic before/after JSONB capture); default grants and `REVOKE`s for `anon`,
`authenticated`, `service_role`. Supabase provides the roles — we do not create them.

**0002 — identity (M01)**
`app_user` (**`id` FK → `auth.users(id)` ON DELETE CASCADE**; holds realm, status,
`must_change_password`, employee attributes), `user_password_history`, `user_login_attempt`,
`role`, `permission`, `role_permission`, `user_role`, `user_scope`, `permission_group`.
Plus `public.custom_access_token_hook(event jsonb) returns jsonb` — the RBAC claim injector — with
`EXECUTE` granted to `supabase_auth_admin` and revoked from `authenticated`, `anon`, `public`.

> Gone compared with the pre-Supabase plan: `user_session`, `user_mfa_totp` and `user_invitation`.
> GoTrue owns sessions (`auth.sessions`, `auth.refresh_tokens`), MFA factors and invitations. Do not
> shadow them — a second copy that must never disagree is a defect generator.

**0003 — audit & events (M07)**
`audit_log`, `domain_event`, `outbox`, `outbox_dead_letter`.

**0004 — master data (M02)**
`branch`, `region`, `woreda`, `coffee_type`, `coffee_grade`, `screen_size`, `certification`,
`harvest_year`, `output_classification`, `bag_type`, `bag_type_version`, `bag_weight_class`,
`unit_of_measure`, `business_type`, `kyc_document_type`, `kyc_document_requirement`, `reason_code`,
`reason_code_category`, `shift`, `holiday`, `labour_activity_type`.

**0005 — warehouse & capacity (M12)**
`warehouse`, `store_room`, `store_section`, `capacity_reservation`, `location_alert_threshold`.

**0006 — customers**
`customer`, `customer_contact`, `customer_bank_account`, `customer_document`, `customer_hold`.

**0007 — onboarding (M08)**
`customer_application`, `application_contact`, `application_document`, `application_review`,
`application_status_history`.

**0008 — files (M05 seam)**
`stored_file` (metadata, checksum, scan status; `storage_key` references a Supabase Storage object),
`file_link`, `file_scan_result`. Plus Storage bucket definitions and their RLS policies on
`storage.objects`. Buckets are **private**; access is always via a short-lived signed URL issued by
our own authorized route handler, never by a public bucket.

**0009 — printing & numbering (M06)**
`document_number_series`, `document_template`, `label_template`, `printed_document`, `qr_token`.

**0010 — notifications (M04)**
`notification_template`, `notification`, `notification_delivery_attempt`,
`notification_preference`.

**0011 — consignment spine**
`consignment`, `consignment_status_history`, `consignment_transition`, `lot`,
`lot_status_history`, `lot_lineage`.

**0012 — stock**
`stock_movement`, `stock_balance`, `stock_transfer`, `stock_adjustment`, `stock_count`,
`stock_count_line`.

**0013 — inbound (M11)**
`delivery_request`, `delivery_request_line`, `delivery_request_decision`, `goods_receipt`,
`goods_receipt_line`, `weighing_record`, `kesha_confirmation`, `kesha_confirmation_line`,
`store_placement`, `store_placement_line`.

**0014 — kesha (M13)**
`empty_bag_stock`, `empty_bag_movement`, `customer_owned_bag`, `bag_reconciliation`,
`bag_reconciliation_line`.

**0015 — scheduling (M14)**
`production_line`, `production_calendar`, `production_shift_slot`, `processing_request`,
`processing_request_lot`, `appointment`, `appointment_history`, `appointment_delay`.

**0016 — processing (M15)**
`job_order`, `job_order_status_history`, `job_input`, `job_output`, `job_loss`,
`job_mass_balance`.

**0017 — acceptance (M16)**
`acceptance`, `acceptance_line`, `acceptance_signature`.

**0018 — dispatch (M17)**
`release_request`, `release_request_line`, `dispatch`, `dispatch_line`, `gate_pass`, `gate_event`,
`transporter`, `vehicle`, `driver`.

**0019 — labour (M18)**
`labour_gang`, `labour_worker`, `gang_membership`, `piece_rate`, `piece_rate_version`,
`labour_activity`, `labour_earning`, `labour_payment_voucher`, `labour_voucher_line`.

**0020 — administration (M23)**
`system_setting`, `system_setting_history`, `feature_flag`, `support_ticket`,
`support_ticket_message`, `job_queue`, `job_queue_history`, `scheduled_task`.

**0021 — RLS policies**
Enable + `FORCE` RLS on **every** table in `public`, including staff-only ones — a table with RLS
disabled is readable by anyone holding the anon key. Policies for the customer-scoped tables listed
in §4.4; a deny-all default for anything else.

**0022 — reporting views & indexes**
`vw_stock_on_hand`, `vw_room_occupancy`, `vw_ageing_stock`, `vw_consignment_status`,
`vw_yield_by_job`, `vw_labour_cost`, plus the composite indexes listed in §4.8.

---

## 4.6 Migration strategy

### Runner and file convention

Migrations are run by the **Supabase CLI**, which requires a timestamp prefix and tracks applied
migrations in `supabase_migrations.schema_migrations`.

```
supabase/migrations/<YYYYMMDDHHMMSS>_<NNNN>_<verb>_<subject>.sql
```

Example: `20260814091500_0016_create_processing_tables.sql`

- **`YYYYMMDDHHMMSS`** — required by the CLI; determines apply order. Generated by
  `supabase migration new`.
- **`NNNN`** — our own zero-padded sequence, retained _inside_ the name. The timestamp satisfies the
  tool; the sequence number is what makes a review comprehensible and makes two developers claiming
  `0023` a visible merge conflict rather than a silent reordering. Keeping both costs nothing and we
  lose neither property.
- `<verb>` — `create`, `alter`, `add`, `drop`, `backfill`, `enable`, `rename`.
- `<subject>` — snake_case area or table.

**Authoring workflow:**

```bash
supabase migration new 0016_create_processing_tables   # creates the timestamped file
npm run db:generate                                    # drizzle-kit emits the SQL
# paste, hand-edit, add the header block, review
supabase db reset                                      # verify from scratch, locally
supabase db push                                       # apply to the linked project
```

`supabase db diff` is available for capturing dashboard changes, but **schema changes must not be
made in the dashboard** on staging or production — see the trap in §4.6 "Rules" item 10.

Every file opens with a header block:

```sql
-- 0016_create_processing_tables.sql
-- phase:      1
-- module:     M15 Processing Execution & Output Classification
-- author:     <name>
-- ticket:     CPMS-142
-- breaking:   no
-- lock-risk:  low        (new tables only; no locks on existing tables)
-- rollback:   0016_down.sql   (or: forward-fix only — see notes)
```

`lock-risk` is not bureaucracy. A migration that takes `ACCESS EXCLUSIVE` on `stock_movement` during
harvest season stops the plant. Making the author state it forces the thought.

### The rules

1. **Forward-only. A merged migration is immutable.** Fix a mistake with a new migration. Editing
   `0014` after it ran in staging means staging and production have silently different schemas.
2. **One logical change per file.** Reviewable, and bisectable when something breaks.
3. **Every migration runs in a transaction**, except those that cannot (`CREATE INDEX CONCURRENTLY`,
   `ALTER TYPE … ADD VALUE`). Those live in their own file marked `-- no-transaction`.
4. **Set a lock timeout at the top of any migration touching an existing table:**
   ```sql
   SET lock_timeout = '3s';
   SET statement_timeout = '5min';
   ```
   Better to fail fast than to queue behind a long read and block the entire plant.
5. **New indexes on populated tables use `CREATE INDEX CONCURRENTLY`.**
6. **No `DROP` in the same release as the code change.** See expand/contract below.
7. **Data backfills of more than ~10k rows are not migrations** — they are `db/scripts/` jobs, run
   in batches with progress logging and resumability. A migration that runs for forty minutes holds
   a deploy hostage.
8. **Seeds are idempotent** (`ON CONFLICT (code) DO UPDATE`) and safe to run on every deploy. The
   permission catalogue in particular is code-owned and re-synced on every boot, so a new permission
   string can never be missing in production.
9. **CI verifies**: `supabase db reset` applies everything cleanly to an empty database; migrations
   apply cleanly on top of a restored production-shaped dump; the Drizzle schema and the migrated
   database agree (`drizzle-kit check` — a drifted schema fails the build); `supabase db diff`
   against the linked staging project reports **no** unexpected difference.
10. **No schema changes through the Supabase dashboard**, on any environment other than a throwaway
    local one. The dashboard is a convenient way to create drift that no migration file records, and
    Supabase makes it one click away. The CI drift check in item 9 exists specifically to catch this;
    treat a failure as an incident, not as a nuisance.
11. **Never modify the `auth`, `storage` or `realtime` schemas.** They are Supabase-owned and are
    upgraded underneath you. Extend via our own `public.app_user` profile table with an FK to
    `auth.users(id)`, never by adding columns to `auth.users`.

### Expand / contract — how Phase 2 changes land safely

Never change a column in place while old code is running. Four separate deploys:

```
Deploy 1  EXPAND    add the new nullable column / new table. Old code unaffected.
                    0031_add_invoice_id_to_goods_receipt.sql

Deploy 2  BACKFILL  populate it in batches (db/scripts/, not a migration).
                    New code writes BOTH old and new. Reads still use old.

Deploy 3  SWITCH    reads move to the new column. Old column still written for one release
                    so a rollback is possible.

Deploy 4  CONTRACT  stop writing the old column; then, a release later, drop it.
                    0034_drop_legacy_column.sql
```

This is why Phase 2 can add billing to Phase 1 tables without a maintenance window — and why
"just alter the column" is banned even when it looks safe.

### Rollback policy

Down-migrations are written for **schema-only, pre-production** changes and are genuinely useful
during development. For anything that has touched production data, the policy is **roll forward**: a
down-migration that drops a column drops the data in it, so it is not a rollback, it is a second
incident. Recovery from a bad production migration is: stop, restore from PITR if data was lost,
otherwise write `NNNN+1` to correct.

### Naming examples

```
0001_enable_extensions_and_conventions.sql
0002_create_identity_tables.sql
0011_create_consignment_spine.sql
0012_create_stock_ledger.sql
0021_enable_rls_policies.sql
0022_create_reporting_views.sql
-- Phase 2 continues the same sequence, no restructuring:
0023_create_contract_and_tariff_tables.sql          (M10)
0024_create_billing_tables.sql                      (M19)
0025_add_contract_id_to_delivery_request.sql        (additive FK into a Phase 1 table)
0026_create_workflow_engine_tables.sql              (M03)
0027_add_workflow_instance_id_to_approvals.sql      (additive)
-- Phase 3:
0040_create_ai_conversation_tables.sql              (M24)
0041_create_forecast_tables.sql                     (M26)
```

The Phase 2 examples matter: **every one of them is additive.** That is the test of whether the
Phase 1 schema was designed correctly, and it is why the extension points in
[07-extension-points.md](07-extension-points.md) are chosen where they are.

---

## 4.7 Document numbering (M06)

_"Every printed document carries a system-generated number, a print timestamp and the name of the
user who printed it."_

```sql
CREATE TABLE document_number_series (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,            -- 'GRN', 'JOB', 'MIRT', 'GATEPASS', 'VOUCHER'
  prefix text NOT NULL,
  format text NOT NULL DEFAULT '{prefix}-{year}-{seq:6}',
  reset_policy text NOT NULL DEFAULT 'YEARLY',   -- NEVER | YEARLY | MONTHLY
  current_period text NOT NULL,                  -- '2026'
  next_value bigint NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true
);
```

Allocation takes a row lock (`SELECT … FOR UPDATE`) inside the caller's transaction, so a rolled-back
GRN does not burn a number. **Do not use a Postgres sequence:** sequences are non-transactional and
deliberately gap-permitting, and a gap in a legally significant document series invites the
question "where is GRN-2026-000412?" — which nobody wants to answer. Gapless numbering costs a row
lock; take it.

`printed_document` records every render: `series_code`, `number`, `entity_type`, `entity_id`,
`rendered_by`, `rendered_at`, `content_sha256`, `copy_number`, `locale`, `payload_snapshot jsonb`.
Reprints increment `copy_number` and the PDF is watermarked **DUPLICATE**, which is the control that
stops two "originals" of one gate pass circulating.

---

## 4.8 Indexing

Start with these; add the rest from `pg_stat_statements` under real load rather than guessing.

```sql
-- the hottest path: a customer's stock position
CREATE INDEX idx_stock_balance__customer_lot ON stock_balance (customer_id, lot_id)
  WHERE quantity_kg > 0;
CREATE INDEX idx_stock_balance__location     ON stock_balance (location_id)
  WHERE quantity_kg > 0;

-- ledger queries are always "this lot, in time order" or "this document"
CREATE INDEX idx_stock_movement__lot_occurred ON stock_movement (lot_id, occurred_at DESC);
CREATE INDEX idx_stock_movement__source       ON stock_movement (source_type, source_id);
CREATE INDEX idx_stock_movement__correlation  ON stock_movement (correlation_id);

-- operational worklists: "what is waiting for me"
CREATE INDEX idx_consignment__status_customer ON consignment (status, customer_id, created_at DESC);
CREATE INDEX idx_delivery_request__pending    ON delivery_request (status, expected_arrival_on)
  WHERE status = 'SUBMITTED';

-- audit and passport
CREATE INDEX idx_domain_event__aggregate ON domain_event (aggregate_type, aggregate_id, occurred_at);
CREATE INDEX idx_audit_log__entity       ON audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_log__actor        ON audit_log (actor_id, occurred_at DESC);

-- worker
CREATE INDEX idx_job_queue__claimable ON job_queue (run_after, priority)
  WHERE status = 'PENDING';
CREATE INDEX idx_outbox__unpublished  ON outbox (created_at) WHERE published_at IS NULL;

-- search
CREATE INDEX idx_customer__name_trgm ON customer USING gin (legal_name gin_trgm_ops);
```

Partial indexes on `status = 'PENDING'` are deliberate: the pending set stays small forever while
the table grows without bound, so the index stays tiny and hot.

**Never `OFFSET`-paginate the ledger or the audit log.** Use keyset pagination
(`WHERE (occurred_at, id) < ($1, $2) ORDER BY occurred_at DESC, id DESC LIMIT n`) — `db/helpers/pagination.ts`
provides it, and `OFFSET` beyond a few thousand rows degrades linearly.

---

## 4.9 Appointment overlap (M14)

```sql
ALTER TABLE appointment ADD CONSTRAINT ex_appointment__no_overlap
  EXCLUDE USING gist (
    production_line_id WITH =,
    tstzrange(scheduled_start_at, scheduled_end_at, '[)') WITH &&
  ) WHERE (status IN ('SCHEDULED', 'IN_PROGRESS'));
```

Double-booking a line is not an application-level check that "should be fine". Two schedulers, two
browser tabs, one second apart, and application-level validation loses. The database wins that race
every time.

---

## 4.10 Connection management under Supabase

Supabase exposes three connection strings. Using the wrong one is a common and confusing failure.

| Connection            | Port               | Mode        | Use for                                                        |
| --------------------- | ------------------ | ----------- | -------------------------------------------------------------- |
| Direct                | 5432               | session     | **Migrations only.** Not available on IPv4 without the add-on. |
| Supavisor session     | 5432 (pooler host) | session     | Long-lived worker connections; supports prepared statements    |
| Supavisor transaction | **6543**           | transaction | **The application.** Serverless-friendly, short-lived          |

Rules:

- **`prepare: false` on the driver when using port 6543.** Transaction pooling reassigns connections
  between queries, so a named prepared statement issued on one may not exist on the next. Supavisor
  has since added named-prepared-statement support by broadcasting them, but do not rely on it —
  `prepare: false` is the documented, stable configuration for Drizzle/postgres.js here.
- **This is exactly why §4.0 uses `set_config(..., true)` and `set local role`** rather than session-
  level `SET`. Under transaction pooling, session state leaks to the next request on that connection.
  A session-scoped `set_config` here would be a cross-tenant data leak, not a performance nit.
- One pool per process. In development, memoise it on `globalThis` so Turbopack HMR does not exhaust
  connections — a classic Next.js foot-gun, and Supabase's connection limits make it bite sooner.
- Keep the pool small (`DATABASE_POOL_MAX` ≈ 10). Supavisor is already pooling; a large client-side
  pool multiplied by several app instances exhausts the project's connection budget.
- `serverExternalPackages` in `next.config.ts` must include the Postgres driver and
  `@react-pdf/renderer`.
- Statement timeout on the application roles:
  `ALTER ROLE authenticated SET statement_timeout = '30s'`. A runaway report query must not be able
  to hold the plant. Set a longer one for the worker's role.
- **Secrets:** `SUPABASE_SERVICE_ROLE_KEY` and the direct `DATABASE_URL` are server-only and must
  never appear in a `NEXT_PUBLIC_` variable. Only `NEXT_PUBLIC_SUPABASE_URL` and the publishable
  (anon) key are safe in the browser bundle — and the anon key is safe _only_ because RLS is enabled
  on every table, which is the assumption §4.4 exists to guarantee.

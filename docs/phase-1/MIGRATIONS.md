# Migrations — how to apply them

**Status: applied.** The full set ran against the hosted project `jnuwmprlallwvawefonr` on
2026-08-13 — 22 migrations, 125 tables, 104 with RLS and 171 policies, the seed verified
idempotent over two consecutive runs, and the first System Administrator created.

They were previously described here as "written and reviewed but unproven". That was
accurate, and the first real run found three defects that no amount of review had caught:

| Symptom                                                                     | Cause                                                                                                                                                                  | Fix                                                                                          |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `relation "public.job_queue" does not exist` at 0021                        | `job_queue`, `system_setting` and `system_setting_history` were defined in `src/db/schema/administration.ts` and used by the worker, but **no migration created them** | Added **0009**, transcribed from the Drizzle definitions and timestamped to land before 0021 |
| `column "sort_order" of relation "region" does not exist`                   | The seed's `upsertLookup` wrote `sort_order` unconditionally; `region` and `reason_code_category` do not have it                                                       | Column presence now resolved from `information_schema` and cached                            |
| `null value in column "ownership" of relation "bag_type" violates not-null` | `upsertLookup` sent an explicit `NULL` for any unspecified extra column, which overrides the column DEFAULT                                                            | Unspecified columns are now omitted, letting the DEFAULT apply                               |

The last two were latent in every lookup table, not just the one that happened to fail first.

A fourth surfaced on creating the first account, and was the most serious of them:

**No user could be created through Supabase Auth at all.** GoTrue inserts `auth.users` →
`trg_auth_users__create_profile` inserts `public.app_user` → `trg_app_user__audit` calls
`fn_current_actor_id`, which raises _"No acting user in context"_ because GoTrue's connection
carries no JWT claims and no `app.actor_id`. It never passes through `withAuthenticatedDb()`.

This blocked every route to a new account — the Admin API, invites, and the credential-issue
flow that runs when a customer application is approved. Fixed in **0023**, which sets
`app.actor_id` to the new user's own id for the duration of the statement. That is the same
identity the function already writes to `created_by`, and there is no other actor in
existence at that instant.

---

## The files, in order

| #    | File                                                 | Contents                                                                                                                                                                                      |
| ---- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001 | `…_0001_enable_extensions_and_conventions.sql`       | Extensions (incl. `btree_gist`, needed by the EXCLUDE constraints), `fn_set_updated_at`, `fn_block_mutation`, `fn_current_actor_id`, `fn_audit_row`, trigger helpers, default grants          |
| 0003 | `…_0003_create_audit_and_event_tables.sql`           | `audit_log`, `domain_event` (both partitioned, append-only), `outbox`, `outbox_dead_letter`. **Must run right after 0001** — `fn_audit_row` writes to `audit_log`.                            |
| 0002 | `…_0002_create_identity_tables.sql`                  | `app_user` (FK → `auth.users`), RBAC, scopes, `custom_access_token_hook`, profile-creation trigger                                                                                            |
| 0004 | `…_0004_create_master_data_tables.sql`               | 21 master-data tables, the four output classifications, `bag_type_version` with its no-overlap EXCLUDE constraint                                                                             |
| 0005 | `…_0005_create_warehouse_tables.sql`                 | warehouse → room → section, capacity reservations, `vw_section_capacity`                                                                                                                      |
| 0009 | `…_0009_create_administration_tables.sql`            | `job_queue` (M23 infrastructure), `system_setting`, `system_setting_history` (append-only — the M23 key control). **Must run before 0021**, which attaches staff-only policies to all three.  |
| 0011 | `…_0011_create_consignment_spine.sql`                | `consignment`, `lot`, lineage, status history, the **transition guard trigger**, the **lineage cycle guard**                                                                                  |
| 0012 | `…_0012_create_stock_ledger.sql`                     | `stock_movement` (partitioned, append-only), `stock_balance` + its maintainer trigger, reconcile/rebuild functions, `vw_stock_on_hand`                                                        |
| 0021 | `…_0021_enable_rls_policies.sql`                     | Enables + FORCEs RLS on every `public` table, the staff/customer policy pairs, and a guard that FAILS the migration if any table ends up with RLS on and no policy                            |
| 0006 | `…_0006_create_file_tables.sql`                      | `stored_file`, `file_access_log` (M05)                                                                                                                                                        |
| 0007 | `…_0007_create_customer_tables.sql`                  | `customer`, contacts, addresses, bank accounts, status history (M07)                                                                                                                          |
| 0008 | `…_0008_create_onboarding_tables.sql`                | `customer_application`, documents, status history (M08). Closes the customer ⇄ application cycle left open by 0007                                                                            |
| 0013 | `…_0013_create_inbound_tables.sql`                   | delivery requests, gate passes, weighbridge tickets, goods receipts, inspections, gate events (M11). Closes the forward references left open by 0005 and 0011                                 |
| 0014 | `…_0014_create_kesha_tables.sql`                     | `kesha_movement` (append-only), `kesha_balance`, reconciliations (M13)                                                                                                                        |
| 0015 | `…_0015_create_scheduling_tables.sql`                | machines, daily capacity, appointments, delays (M14)                                                                                                                                          |
| 0016 | `…_0016_create_processing_tables.sql`                | processing requests, job orders, inputs, outputs, production logs (M15)                                                                                                                       |
| 0017 | `…_0017_create_acceptance_tables.sql`                | Mirt Merekebiya records and lines (M16)                                                                                                                                                       |
| 0018 | `…_0018_create_dispatch_tables.sql`                  | vehicles, release requests, dispatch orders and lines (M17)                                                                                                                                   |
| 0019 | `…_0019_create_labour_tables.sql`                    | workers, crews, rates, attendance, output, payroll periods (M18)                                                                                                                              |
| 0020 | `…_0020_create_notification_and_printing_tables.sql` | notification and document templates, `notification`, `printed_document`, verification log (M04, M06)                                                                                          |
| 0022 | `…_0022_enable_rls_phase1_remainder.sql`             | **RLS for everything 0006–0020 created.** Must ship in the SAME deployment — until it runs those tables have grants and no policies, which means `authenticated` can read across customers    |
| 0023 | `…_0023_fix_auth_user_profile_actor_context.sql`     | Replaces `fn_handle_new_auth_user` so it sets `app.actor_id` before inserting the profile. Without it **no account can be created through Supabase Auth at all** — see the defect table above |

Numbers are aligned with [roadmap.md](roadmap.md) rather than with execution order. Gaps in
the sequence are fine; **re-using a number is not.**

⚠️ **0022 is not optional and must not be deferred.** 0021 secured the tables that existed
when it ran. Everything 0006–0020 creates comes afterwards, so without 0022 those 53 tables
carry grants and no row-level security at all.

File order is by TIMESTAMP, not by the `NNNN` label, and the timestamps are set so 0003 runs
immediately after 0001 — before 0002 attaches any audit trigger.

---

## Applying them

Locally:

```bash
supabase start
supabase db reset
npm run db:seed
```

Against a hosted project, without linking. Note the password must be **percent-encoded** —
a connection string is a URL, so `@` `#` `$` become `%40` `%23` `%24`, and pasting them raw
produces a misleading "password authentication failed" rather than a parse error:

```bash
npx supabase db push --db-url 'postgresql://postgres:<ENCODED-PW>@db.<ref>.supabase.co:5432/postgres'
```

The seed reads `process.env` directly and does **not** load `.env.local`, so pass it in:

```bash
DIRECT_URL='postgresql://postgres:<ENCODED-PW>@db.<ref>.supabase.co:5432/postgres' npm run db:seed
```

Then create the first staff account — the seed deliberately creates none:

```bash
ADMIN_PASSWORD='...' npx tsx scripts/create-admin.ts --email you@ethiostar.com --name "Your Name"
```

Then confirm the seed is idempotent — this is a real check, not a formality, because the seed
runs on every deploy:

```bash
npm run db:seed
```

Nothing should change on the second run, and the log should report role grants "left
untouched".

---

## Two things SQL cannot do

Both are dashboard-only on hosted Supabase, and the application is broken in a confusing way
until they are done.

**1. Enable the Custom Access Token hook.** Authentication → Hooks → _Customize Access Token
(JWT) Claims_ → `public.custom_access_token_hook`.

Migration 0002 creates the function and grants it to `supabase_auth_admin`, but nothing
activates it — `supabase/config.toml` wires it up for LOCAL Supabase only, and that block is
commented out. Without it the JWT carries no `actor_kind` or `must_change_password`, and
`src/proxy.ts` reads exactly those to route staff to `/dashboard` versus customers to
`/portal/dashboard` and to force the first-login password change. Data scoping still holds —
`pageContext()` builds its claims from `actor.customerId`, which the DAL reads from the
database — so the failure looks like bad routing, not bad security.

**2. Set the auth URL configuration.** Authentication → URL Configuration. The Site URL and
redirect allow-list must contain the origin in `APP_URL`, or the links in recovery and invite
mail will bounce.

---

## What to verify once they are applied

In rough order of how much it would hurt to get wrong.

**1. The transition guard actually refuses a skipped state.**

```sql
-- Should FAIL with "Illegal consignment transition"
UPDATE consignment SET status = 'DISPATCHED' WHERE status = 'STORED';
```

**2. The ledger is append-only, for `service_role` too.**
`service_role` bypasses RLS but not triggers or grants, which is why both exist.

```sql
-- Both should FAIL
UPDATE stock_movement SET quantity_kg = 0 WHERE id = '…';
DELETE FROM audit_log WHERE id = '…';
```

**3. The balance projection tracks the ledger.**
Insert a few movements, then:

```sql
SELECT * FROM fn_reconcile_stock_balance();  -- must return ZERO rows
```

**4. An un-attributed write is impossible.**
A write with no `app.actor_id` and no JWT should raise from `fn_current_actor_id`.

**5. The EXCLUDE constraints bite.**

```sql
-- Second insert should FAIL: overlapping effective dates for one bag type
INSERT INTO bag_type_version (…) VALUES (…'2020-01-01', NULL…);
```

**6. RLS isolates customers under the POOLER, not just a direct connection.**
The leak this guards against only manifests under transaction pooling. Run two interleaved
transactions on one pooled connection and confirm customer A never sees customer B's rows.
This is [08-testing.md §8.2 #14](../architecture/08-testing.md) and is the single most
important test in the suite.

> Migration 0021 enables and FORCEs RLS on every `public` table and ends with a check that
> fails the migration if any table has RLS on but no policy — a table in that state is
> invisible to the application and the cause is baffling.
>
> `service_role` bypasses ALL of it. No policy can constrain it, which is why
> `scripts/guard-service-role.ts` fails the build if it is used outside the three sanctioned
> places.

---

## Rules that still apply

- **Forward-only.** A merged migration is immutable; fix a mistake with a new one.
- **Never edit schema through the Supabase dashboard.** `supabase db diff --linked` in CI
  exists to catch exactly that, and a difference is an incident, not a nuisance.
- **Additive only** into tables that already exist in production — expand/contract, per
  [04-database-and-migrations.md §4.6](../architecture/04-database-and-migrations.md).

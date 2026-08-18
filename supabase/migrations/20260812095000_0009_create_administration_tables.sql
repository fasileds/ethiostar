-- 20260812095000_0009_create_administration_tables.sql
-- phase:      1
-- module:     M23 Administration — job queue and runtime settings
-- ticket:     CPMS-009
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- WHY THIS FILE EXISTS
--
-- These three tables are defined in src/db/schema/administration.ts, exported from the
-- schema barrel, and used by src/platform/queue/postgres-queue.ts and src/worker/main.ts —
-- but no migration ever created them. 0021 then loops over a table list that names
-- `job_queue`, `system_setting` and `system_setting_history` to attach staff-only policies,
-- so `supabase db push` failed there with:
--
--     ERROR: relation "public.job_queue" does not exist (SQLSTATE 42P01)
--
-- The DDL below is transcribed from the Drizzle definitions, which are the authoritative
-- description of these tables. The timestamp places it after 0005 and before 0021, so the
-- tables exist by the time RLS is applied to them.
--
-- docs/adr/0008-background-jobs.md

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════

-- Postgres-backed queue, claimed with FOR UPDATE SKIP LOCKED. No Redis, no broker: one
-- database to back up, restore and monitor, and enqueue is transactional with the business
-- write — the same property the outbox has, for the same reason.
CREATE TABLE "job_queue" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"last_error" text,
	"idempotency_key" text,
	"correlation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ck_job_queue__status"
		CHECK ("job_queue"."status" in ('PENDING','CLAIMED','DONE','FAILED','DEAD')),
	CONSTRAINT "ck_job_queue__attempts"
		CHECK ("job_queue"."attempts" >= 0 AND "job_queue"."attempts" <= "job_queue"."max_attempts")
);

-- Runtime BUSINESS rules — mass-balance tolerance, safe-fill %, free storage days,
-- approval thresholds — changeable by an authorised administrator without a deployment.
-- Infrastructure wiring lives in environment variables and is deliberately NOT here.
CREATE TABLE "system_setting" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"value_type" text NOT NULL,
	"description" text NOT NULL,
	"unit" text,
	"editable_by_permission" text DEFAULT 'admin:manage_settings' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_system_setting__value_type"
		CHECK ("system_setting"."value_type" in ('number','string','boolean','json','duration','percentage'))
);

-- The M23 key control: "Every configuration change is logged with the user, the old value
-- and the new value." Append-only, enforced by trigger below rather than by policy.
CREATE TABLE "system_setting_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"setting_key" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb NOT NULL,
	"reason" text,
	"changed_by" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════

-- Partial: the claimable set stays small forever while the table grows without bound, so
-- the worker's poll query stays cheap no matter how much history accumulates.
CREATE INDEX "idx_job_queue__claimable"
	ON "job_queue" ("priority", "run_after") WHERE "status" = 'PENDING';

CREATE INDEX "idx_job_queue__type_status" ON "job_queue" ("job_type", "status");

CREATE INDEX "idx_job_queue__dead"
	ON "job_queue" ("created_at" DESC) WHERE "status" = 'DEAD';

-- Enqueue-once semantics. A handler that re-enqueues on retry cannot create a duplicate,
-- which matters because at-least-once delivery means retries happen.
CREATE UNIQUE INDEX "uq_job_queue__idempotency"
	ON "job_queue" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;

CREATE UNIQUE INDEX "uq_system_setting__key" ON "system_setting" ("key");

CREATE INDEX "idx_system_setting_history__key"
	ON "system_setting_history" ("setting_key", "changed_at" DESC);

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
-- system_setting carries the standard created_at/updated_at/version columns, so it takes
-- the standard trigger set. job_queue does not have updated_at — it is worker-owned
-- infrastructure, not a business table — so it only takes its grants.
DO $$
BEGIN
  PERFORM public.fn_attach_standard_triggers('system_setting');
  EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.system_setting TO authenticated';
END $$;

-- The worker claims, updates and completes jobs, and runs as service_role. `authenticated`
-- needs to enqueue (a business write raises a job in the same transaction) and to read
-- queue health for the admin screen, but never to rewrite a job's outcome.
GRANT SELECT, INSERT, UPDATE ON public.job_queue TO authenticated;

-- Append-only: the settings history IS the audit control, so it is protected the same way
-- every other ledger in this schema is. The BEFORE trigger fires regardless of role, which
-- matters because service_role bypasses RLS entirely — a policy alone would not stop a
-- privileged path from rewriting the record of who changed what.
DO $$
BEGIN
  PERFORM public.fn_attach_append_only('system_setting_history');
  EXECUTE 'GRANT SELECT, INSERT ON public.system_setting_history TO authenticated';
END $$;

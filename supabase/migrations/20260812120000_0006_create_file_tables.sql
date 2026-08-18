-- 20260812120000_0006_create_file_tables.sql
-- phase:      1
-- module:     M05 File & Document Management
-- ticket:     CPMS-006
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- The BYTES live in Supabase Storage; these tables are the metadata and the access
-- record. A row is written PENDING before the upload so a half-finished upload leaves
-- something a worker can sweep rather than an orphan object nobody knows about.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE "file_access_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"file_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "stored_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" bigint,
	"checksum_sha256" text,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"category" text DEFAULT 'OTHER' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"uploaded_at" timestamp with time zone,
	"quarantine_reason" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_stored_file__status" CHECK ("stored_file"."status" in ('PENDING','AVAILABLE','QUARANTINED','DELETED')),
	CONSTRAINT "ck_stored_file__size" CHECK ("stored_file"."byte_size" is null or "stored_file"."byte_size" >= 0)
);

-- ═════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "file_access_log" ADD CONSTRAINT "file_access_log_file_id_stored_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_file"("id") ON DELETE cascade ON UPDATE no action;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
CREATE INDEX "idx_file_access_log__file" ON "file_access_log" USING btree ("file_id","occurred_at");
CREATE INDEX "idx_file_access_log__actor" ON "file_access_log" USING btree ("actor_id","occurred_at");
CREATE UNIQUE INDEX "uq_stored_file__object" ON "stored_file" USING btree ("bucket","object_key");
CREATE INDEX "idx_stored_file__source" ON "stored_file" USING btree ("source_type","source_id");
CREATE INDEX "idx_stored_file__pending" ON "stored_file" USING btree ("created_at") WHERE "stored_file"."status" = 'PENDING';

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stored_file'
  ] LOOP
    PERFORM public.fn_attach_standard_triggers(t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Append-only: history, ledgers and logs. The BEFORE trigger fires regardless of
-- role, which matters because service_role bypasses RLS entirely — a policy alone
-- would not stop a privileged path from rewriting history.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'file_access_log'
  ] LOOP
    PERFORM public.fn_attach_append_only(t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

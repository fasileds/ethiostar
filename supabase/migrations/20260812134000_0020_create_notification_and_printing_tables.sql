-- 20260812134000_0020_create_notification_and_printing_tables.sql
-- phase:      1
-- module:     M04 Notification & Alerts, M06 Printing & Documents
-- ticket:     CPMS-020
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- A notification is QUEUED inside the business transaction and SENT by a worker after it
-- commits. Sending inline means a gateway timeout rolling back a goods receipt, and an
-- SMS delivered for a transaction that then rolled back.
--
-- printed_document is append-only with a per-source copy number, so a reprint is
-- visible as a reprint rather than indistinguishable from the original.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid,
	"template_code" text,
	"channel" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"recipient_user_id" uuid,
	"recipient_customer_id" uuid,
	"recipient_address" text,
	"subject" text,
	"rendered_body" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"correlation_id" uuid NOT NULL,
	"causation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_notification__status" CHECK ("notification"."status" in ('PENDING','SENDING','SENT','DELIVERED','FAILED','CANCELLED')),
	CONSTRAINT "ck_notification__channel" CHECK ("notification"."channel" in ('EMAIL','SMS','IN_APP')),
	CONSTRAINT "ck_notification__priority" CHECK ("notification"."priority" in ('LOW','NORMAL','HIGH','URGENT')),
	CONSTRAINT "ck_notification__has_recipient" CHECK ("notification"."recipient_user_id" is not null or "notification"."recipient_customer_id" is not null or "notification"."recipient_address" is not null),
	CONSTRAINT "ck_notification__failure_reason" CHECK ("notification"."status" <> 'FAILED' or "notification"."failure_reason" is not null)
);

CREATE TABLE "notification_preference" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"customer_id" uuid,
	"event_type" text NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_notification_preference__subject" CHECK ("notification_preference"."user_id" is not null or "notification_preference"."customer_id" is not null)
);

CREATE TABLE "notification_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"channel" text NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"variables" jsonb,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_notification_template__channel" CHECK ("notification_template"."channel" in ('EMAIL','SMS','IN_APP')),
	CONSTRAINT "ck_notification_template__locale" CHECK ("notification_template"."locale" in ('en','am'))
);

CREATE TABLE "document_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"document_type" text NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"title" text NOT NULL,
	"layout" jsonb,
	"page_size" text DEFAULT 'A4' NOT NULL,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_document_template__locale" CHECK ("document_template"."locale" in ('en','am'))
);

CREATE TABLE "document_verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"printed_document_id" uuid,
	"presented_token" text NOT NULL,
	"result" text NOT NULL,
	"scanned_by" uuid,
	"ip_address" text,
	"user_agent" text,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_document_verification__result" CHECK ("document_verification"."result" in ('VALID','NOT_FOUND','SUPERSEDED'))
);

CREATE TABLE "printed_document" (
	"id" uuid PRIMARY KEY NOT NULL,
	"template_id" uuid,
	"document_type" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"document_reference" text,
	"copy_no" integer DEFAULT 1 NOT NULL,
	"is_reprint" text GENERATED ALWAYS AS (case when copy_no > 1 then 'Y' else 'N' end) STORED,
	"reprint_reason" text,
	"verification_token" text NOT NULL,
	"printed_snapshot" jsonb,
	"file_id" uuid,
	"locale" text DEFAULT 'en' NOT NULL,
	"printed_by" uuid NOT NULL,
	"printed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"printer_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ck_printed_document__copy_no" CHECK ("printed_document"."copy_no" >= 1),
	CONSTRAINT "ck_printed_document__reprint_reason" CHECK ("printed_document"."copy_no" = 1 or "printed_document"."reprint_reason" is not null)
);

-- ═════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "notification" ADD CONSTRAINT "notification_template_id_notification_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."notification_template"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "document_template" ADD CONSTRAINT "document_template_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "document_verification" ADD CONSTRAINT "document_verification_printed_document_id_printed_document_id_fk" FOREIGN KEY ("printed_document_id") REFERENCES "public"."printed_document"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "printed_document" ADD CONSTRAINT "printed_document_template_id_document_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."document_template"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "printed_document" ADD CONSTRAINT "printed_document_file_id_stored_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
CREATE INDEX "idx_notification__pending" ON "notification" USING btree ("scheduled_for") WHERE "notification"."status" = 'PENDING';
CREATE INDEX "idx_notification__recipient_user" ON "notification" USING btree ("recipient_user_id","created_at");
CREATE INDEX "idx_notification__recipient_customer" ON "notification" USING btree ("recipient_customer_id","created_at");
CREATE INDEX "idx_notification__source" ON "notification" USING btree ("source_type","source_id");
CREATE INDEX "idx_notification__correlation" ON "notification" USING btree ("correlation_id");
CREATE UNIQUE INDEX "uq_notification_preference__user" ON "notification_preference" USING btree ("user_id","event_type");
CREATE UNIQUE INDEX "uq_notification_preference__customer" ON "notification_preference" USING btree ("customer_id","event_type");
CREATE UNIQUE INDEX "uq_notification_template__key" ON "notification_template" USING btree ("code","channel","locale","template_version");
CREATE INDEX "idx_notification_template__code" ON "notification_template" USING btree ("code","is_active");
CREATE UNIQUE INDEX "uq_document_template__key" ON "document_template" USING btree ("code","locale","template_version");
CREATE INDEX "idx_document_template__type" ON "document_template" USING btree ("document_type","is_active");
CREATE INDEX "idx_document_verification__document" ON "document_verification" USING btree ("printed_document_id","scanned_at");
CREATE INDEX "idx_document_verification__failures" ON "document_verification" USING btree ("presented_token","scanned_at") WHERE "document_verification"."result" <> 'VALID';
CREATE UNIQUE INDEX "uq_printed_document__token" ON "printed_document" USING btree ("verification_token");
CREATE UNIQUE INDEX "uq_printed_document__copy" ON "printed_document" USING btree ("source_type","source_id","copy_no");
CREATE INDEX "idx_printed_document__source" ON "printed_document" USING btree ("source_type","source_id");
CREATE INDEX "idx_printed_document__reference" ON "printed_document" USING btree ("document_reference");
CREATE INDEX "idx_printed_document__printed_by" ON "printed_document" USING btree ("printed_by","printed_at");

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'notification_template','notification','notification_preference','document_template'
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
    'printed_document','document_verification'
  ] LOOP
    PERFORM public.fn_attach_append_only(t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

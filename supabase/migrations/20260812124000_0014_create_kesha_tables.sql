-- 20260812124000_0014_create_kesha_tables.sql
-- phase:      1
-- module:     M13 Kesha (Bag) Tracking & Reconciliation
-- ticket:     CPMS-014
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- kesha_movement is an append-only ledger in the same shape as stock_movement, and
-- kesha_balance is a projection rebuildable from it. A bag count that can be edited is
-- a bag count nobody trusts, which is the whole reason this module exists.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE "kesha_balance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_id" uuid NOT NULL,
	"bag_type_id" uuid,
	"branch_id" uuid NOT NULL,
	"held_full" integer DEFAULT 0 NOT NULL,
	"held_empty" integer DEFAULT 0 NOT NULL,
	"damaged" integer DEFAULT 0 NOT NULL,
	"returned" integer DEFAULT 0 NOT NULL,
	"last_movement_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_kesha_balance__held_full" CHECK ("kesha_balance"."held_full" >= 0),
	CONSTRAINT "ck_kesha_balance__held_empty" CHECK ("kesha_balance"."held_empty" >= 0)
);

CREATE TABLE "kesha_movement" (
	"id" uuid PRIMARY KEY NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"consignment_id" uuid,
	"bag_type_id" uuid,
	"location_id" uuid,
	"movement_type" text NOT NULL,
	"kesha_delta" integer NOT NULL,
	"condition" text DEFAULT 'GOOD' NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"reason_code" text,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ck_kesha_movement__type" CHECK ("kesha_movement"."movement_type" in ('RECEIVED_FULL','EMPTIED','REFILLED','RETURNED_EMPTY','RETURNED_FULL','DAMAGED','RETAINED','ADJUSTMENT')),
	CONSTRAINT "ck_kesha_movement__condition" CHECK ("kesha_movement"."condition" in ('GOOD','DAMAGED','UNUSABLE')),
	CONSTRAINT "ck_kesha_movement__delta_nonzero" CHECK ("kesha_movement"."kesha_delta" <> 0),
	CONSTRAINT "ck_kesha_movement__adjustment_reason" CHECK ("kesha_movement"."movement_type" <> 'ADJUSTMENT' or "kesha_movement"."reason_code" is not null)
);

CREATE TABLE "kesha_reconciliation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"bag_type_id" uuid,
	"counted_on" date NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"expected_full" integer NOT NULL,
	"expected_empty" integer NOT NULL,
	"counted_full" integer NOT NULL,
	"counted_empty" integer NOT NULL,
	"variance_full" integer GENERATED ALWAYS AS (counted_full - expected_full) STORED,
	"variance_empty" integer GENERATED ALWAYS AS (counted_empty - expected_empty) STORED,
	"damaged_found" integer DEFAULT 0 NOT NULL,
	"estimated_value" numeric(14, 3),
	"counted_by" uuid NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"variance_reason" text,
	"customer_rep_name" text,
	"customer_signed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_kesha_reconciliation__status" CHECK ("kesha_reconciliation"."status" in ('DRAFT','COUNTED','REVIEWED','POSTED','CANCELLED')),
	CONSTRAINT "ck_kesha_reconciliation__counts" CHECK ("kesha_reconciliation"."counted_full" >= 0 and "kesha_reconciliation"."counted_empty" >= 0),
	CONSTRAINT "ck_kesha_reconciliation__variance_explained" CHECK ("kesha_reconciliation"."status" <> 'POSTED'
           or (counted_full = expected_full and counted_empty = expected_empty)
           or "kesha_reconciliation"."variance_reason" is not null)
);

-- ═════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "kesha_balance" ADD CONSTRAINT "kesha_balance_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kesha_balance" ADD CONSTRAINT "kesha_balance_bag_type_id_bag_type_id_fk" FOREIGN KEY ("bag_type_id") REFERENCES "public"."bag_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kesha_balance" ADD CONSTRAINT "kesha_balance_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kesha_movement" ADD CONSTRAINT "kesha_movement_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kesha_movement" ADD CONSTRAINT "kesha_movement_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kesha_movement" ADD CONSTRAINT "kesha_movement_consignment_id_consignment_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignment"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kesha_movement" ADD CONSTRAINT "kesha_movement_bag_type_id_bag_type_id_fk" FOREIGN KEY ("bag_type_id") REFERENCES "public"."bag_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kesha_movement" ADD CONSTRAINT "kesha_movement_location_id_store_section_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."store_section"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kesha_reconciliation" ADD CONSTRAINT "kesha_reconciliation_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kesha_reconciliation" ADD CONSTRAINT "kesha_reconciliation_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "kesha_reconciliation" ADD CONSTRAINT "kesha_reconciliation_bag_type_id_bag_type_id_fk" FOREIGN KEY ("bag_type_id") REFERENCES "public"."bag_type"("id") ON DELETE no action ON UPDATE no action;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX "uq_kesha_balance__key" ON "kesha_balance" USING btree ("customer_id","bag_type_id","branch_id");
CREATE INDEX "idx_kesha_balance__customer" ON "kesha_balance" USING btree ("customer_id");
CREATE INDEX "idx_kesha_movement__customer" ON "kesha_movement" USING btree ("customer_id","occurred_at");
CREATE INDEX "idx_kesha_movement__consignment" ON "kesha_movement" USING btree ("consignment_id");
CREATE INDEX "idx_kesha_movement__source" ON "kesha_movement" USING btree ("source_type","source_id");
CREATE INDEX "idx_kesha_movement__type" ON "kesha_movement" USING btree ("movement_type","occurred_at");
CREATE UNIQUE INDEX "uq_kesha_reconciliation__reference" ON "kesha_reconciliation" USING btree ("reference");
CREATE INDEX "idx_kesha_reconciliation__customer" ON "kesha_reconciliation" USING btree ("customer_id","counted_on");
CREATE INDEX "idx_kesha_reconciliation__status" ON "kesha_reconciliation" USING btree ("status");

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kesha_balance','kesha_reconciliation'
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
    'kesha_movement'
  ] LOOP
    PERFORM public.fn_attach_append_only(t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

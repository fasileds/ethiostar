-- 20260812131000_0017_create_acceptance_tables.sql
-- phase:      1
-- module:     M16 Mirt Merekebiya (Customer Output Acceptance)
-- ticket:     CPMS-017
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- The commercial hinge: until the customer signs, output is EthioStar's problem.
--
-- ck_acceptance_record__accepted_is_signed refuses an ACCEPTED record without a
-- signature and a name. Without both it is not evidence, and the dispatch clearance
-- check in 0018 depends on it being evidence.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE "acceptance_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"acceptance_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"lot_id" uuid,
	"classification_id" uuid,
	"presented_quantity_kg" numeric(14, 3) NOT NULL,
	"presented_kesha_count" integer,
	"accepted_quantity_kg" numeric(14, 3),
	"accepted_kesha_count" integer,
	"line_verdict" text DEFAULT 'ACCEPTED' NOT NULL,
	"remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_acceptance_line__verdict" CHECK ("acceptance_line"."line_verdict" in ('ACCEPTED','REJECTED','DISPUTED')),
	CONSTRAINT "ck_acceptance_line__presented" CHECK ("acceptance_line"."presented_quantity_kg" >= 0)
);

CREATE TABLE "acceptance_record" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"consignment_id" uuid NOT NULL,
	"job_order_id" uuid,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"presented_quantity_kg" numeric(14, 3) NOT NULL,
	"presented_kesha_count" integer,
	"accepted_quantity_kg" numeric(14, 3),
	"accepted_kesha_count" integer,
	"disputed_quantity_kg" numeric(14, 3),
	"yield_pct" numeric(6, 3),
	"loss_pct" numeric(6, 3),
	"presented_at" timestamp with time zone,
	"presented_by" uuid,
	"customer_rep_name" text,
	"customer_rep_id_no" text,
	"customer_contact_id" uuid,
	"signed_at" timestamp with time zone,
	"signature_file_id" uuid,
	"witness_name" text,
	"witness_user_id" uuid,
	"dispute_reason" text,
	"dispute_raised_at" timestamp with time zone,
	"dispute_resolved_at" timestamp with time zone,
	"dispute_resolution" text,
	"dispute_resolved_by" uuid,
	"supersedes_id" uuid,
	"superseded_reason" text,
	"closed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_acceptance_record__status" CHECK ("acceptance_record"."status" in ('DRAFT','PRESENTED','ACCEPTED','PARTIALLY_ACCEPTED','DISPUTED','CLOSED','CANCELLED')),
	CONSTRAINT "ck_acceptance_record__presented_qty" CHECK ("acceptance_record"."presented_quantity_kg" > 0),
	CONSTRAINT "ck_acceptance_record__accepted_within_presented" CHECK ("acceptance_record"."accepted_quantity_kg" is null or "acceptance_record"."accepted_quantity_kg" <= "acceptance_record"."presented_quantity_kg"),
	CONSTRAINT "ck_acceptance_record__accepted_is_signed" CHECK ("acceptance_record"."status" not in ('ACCEPTED','PARTIALLY_ACCEPTED') or ("acceptance_record"."signed_at" is not null and "acceptance_record"."customer_rep_name" is not null)),
	CONSTRAINT "ck_acceptance_record__disputed_has_reason" CHECK ("acceptance_record"."status" <> 'DISPUTED' or "acceptance_record"."dispute_reason" is not null)
);

CREATE TABLE "acceptance_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"acceptance_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid
);

-- ═════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "acceptance_line" ADD CONSTRAINT "acceptance_line_acceptance_id_acceptance_record_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptance_record"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "acceptance_line" ADD CONSTRAINT "acceptance_line_lot_id_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lot"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "acceptance_line" ADD CONSTRAINT "acceptance_line_classification_id_output_classification_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."output_classification"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "acceptance_record" ADD CONSTRAINT "acceptance_record_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "acceptance_record" ADD CONSTRAINT "acceptance_record_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "acceptance_record" ADD CONSTRAINT "acceptance_record_consignment_id_consignment_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignment"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "acceptance_record" ADD CONSTRAINT "acceptance_record_job_order_id_job_order_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_order"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "acceptance_record" ADD CONSTRAINT "acceptance_record_signature_file_id_stored_file_id_fk" FOREIGN KEY ("signature_file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "acceptance_status_history" ADD CONSTRAINT "acceptance_status_history_acceptance_id_acceptance_record_id_fk" FOREIGN KEY ("acceptance_id") REFERENCES "public"."acceptance_record"("id") ON DELETE cascade ON UPDATE no action;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX "uq_acceptance_line__no" ON "acceptance_line" USING btree ("acceptance_id","line_no");
CREATE INDEX "idx_acceptance_line__acceptance" ON "acceptance_line" USING btree ("acceptance_id");
CREATE INDEX "idx_acceptance_line__lot" ON "acceptance_line" USING btree ("lot_id");
CREATE UNIQUE INDEX "uq_acceptance_record__reference" ON "acceptance_record" USING btree ("reference");
CREATE INDEX "idx_acceptance_record__consignment" ON "acceptance_record" USING btree ("consignment_id");
CREATE INDEX "idx_acceptance_record__customer" ON "acceptance_record" USING btree ("customer_id","created_at");
CREATE INDEX "idx_acceptance_record__job" ON "acceptance_record" USING btree ("job_order_id");
CREATE INDEX "idx_acceptance_record__status" ON "acceptance_record" USING btree ("status");
CREATE INDEX "idx_acceptance_record__awaiting" ON "acceptance_record" USING btree ("presented_at") WHERE "acceptance_record"."status" = 'PRESENTED';
CREATE INDEX "idx_acceptance_status_history__acceptance" ON "acceptance_status_history" USING btree ("acceptance_id","occurred_at");

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'acceptance_record','acceptance_line'
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
    'acceptance_status_history'
  ] LOOP
    PERFORM public.fn_attach_append_only(t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- 20260812130000_0016_create_processing_tables.sql
-- phase:      1
-- module:     M15 Coffee Processing & Sorting Operations
-- ticket:     CPMS-016
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- Mass balance governs this module: inputs = outputs + loss, within tolerance. Loss is a
-- DESTINATION with a positive quantity (job_order_output.is_loss), never a second
-- withdrawal — treating it as one double-counts it and makes every yield wrong.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE "job_order" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"consignment_id" uuid NOT NULL,
	"processing_request_id" uuid,
	"appointment_id" uuid,
	"machine_id" uuid,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"service_type" text NOT NULL,
	"planned_input_kg" numeric(14, 3) NOT NULL,
	"planned_kesha_count" integer,
	"actual_input_kg" numeric(14, 3),
	"actual_output_kg" numeric(14, 3),
	"actual_loss_kg" numeric(14, 3),
	"yield_pct" numeric(6, 3),
	"loss_pct" numeric(6, 3),
	"mass_balance_status" text,
	"tolerance_applied_pct" numeric(6, 3),
	"variance_kg" numeric(14, 3),
	"variance_approved_by" uuid,
	"variance_approved_at" timestamp with time zone,
	"variance_reason" text,
	"scheduled_start_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"supervisor_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_job_order__status" CHECK ("job_order"."status" in ('PLANNED','RELEASED','IN_PROGRESS','PAUSED','COMPLETED','CLOSED','CANCELLED')),
	CONSTRAINT "ck_job_order__mass_balance" CHECK ("job_order"."mass_balance_status" is null or "job_order"."mass_balance_status" in ('BALANCED','WITHIN_TOLERANCE','EXCEPTION')),
	CONSTRAINT "ck_job_order__planned_input" CHECK ("job_order"."planned_input_kg" > 0),
	CONSTRAINT "ck_job_order__closed_is_balanced" CHECK ("job_order"."status" <> 'CLOSED' or "job_order"."mass_balance_status" is not null)
);

CREATE TABLE "job_order_input" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"lot_id" uuid NOT NULL,
	"location_id" uuid,
	"quantity_kg" numeric(14, 3) NOT NULL,
	"kesha_count" integer,
	"coffee_type_id" uuid,
	"coffee_grade_id" uuid,
	"stock_movement_id" uuid,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_job_order_input__quantity" CHECK ("job_order_input"."quantity_kg" > 0)
);

CREATE TABLE "job_order_output" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"classification_id" uuid,
	"is_loss" boolean DEFAULT false NOT NULL,
	"quantity_kg" numeric(14, 3) NOT NULL,
	"kesha_count" integer,
	"percent_of_input" numeric(6, 3),
	"lot_id" uuid,
	"location_id" uuid,
	"coffee_grade_id" uuid,
	"stock_movement_id" uuid,
	"produced_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_job_order_output__quantity" CHECK ("job_order_output"."quantity_kg" >= 0)
);

CREATE TABLE "job_order_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid
);

CREATE TABLE "job_production_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_order_id" uuid NOT NULL,
	"shift_code" text,
	"logged_on" date NOT NULL,
	"processed_kg" numeric(14, 3) NOT NULL,
	"processed_kesha" integer,
	"run_minutes" integer,
	"downtime_minutes" integer DEFAULT 0 NOT NULL,
	"downtime_reason" text,
	"operator_note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ck_job_production_log__processed" CHECK ("job_production_log"."processed_kg" >= 0),
	CONSTRAINT "ck_job_production_log__downtime_reason" CHECK ("job_production_log"."downtime_minutes" = 0 or "job_production_log"."downtime_reason" is not null)
);

CREATE TABLE "processing_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"consignment_id" uuid,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"service_type" text NOT NULL,
	"requested_quantity_kg" numeric(14, 3) NOT NULL,
	"requested_kesha_count" integer,
	"output_specification" text,
	"preferred_start_on" date,
	"urgency" text DEFAULT 'NORMAL' NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"appointment_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_processing_request__status" CHECK ("processing_request"."status" in ('DRAFT','SUBMITTED','APPROVED','REJECTED','SCHEDULED','COMPLETED','CANCELLED')),
	CONSTRAINT "ck_processing_request__service" CHECK ("processing_request"."service_type" in ('SORTING','HULLING','GRADING','CLEANING','POLISHING')),
	CONSTRAINT "ck_processing_request__urgency" CHECK ("processing_request"."urgency" in ('LOW','NORMAL','HIGH')),
	CONSTRAINT "ck_processing_request__quantity" CHECK ("processing_request"."requested_quantity_kg" > 0)
);

-- ═════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "job_order" ADD CONSTRAINT "job_order_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order" ADD CONSTRAINT "job_order_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order" ADD CONSTRAINT "job_order_consignment_id_consignment_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignment"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order" ADD CONSTRAINT "job_order_processing_request_id_processing_request_id_fk" FOREIGN KEY ("processing_request_id") REFERENCES "public"."processing_request"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order" ADD CONSTRAINT "job_order_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order" ADD CONSTRAINT "job_order_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order_input" ADD CONSTRAINT "job_order_input_job_order_id_job_order_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_order"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "job_order_input" ADD CONSTRAINT "job_order_input_lot_id_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lot"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order_input" ADD CONSTRAINT "job_order_input_location_id_store_section_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."store_section"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order_input" ADD CONSTRAINT "job_order_input_coffee_type_id_coffee_type_id_fk" FOREIGN KEY ("coffee_type_id") REFERENCES "public"."coffee_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order_input" ADD CONSTRAINT "job_order_input_coffee_grade_id_coffee_grade_id_fk" FOREIGN KEY ("coffee_grade_id") REFERENCES "public"."coffee_grade"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order_output" ADD CONSTRAINT "job_order_output_job_order_id_job_order_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_order"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "job_order_output" ADD CONSTRAINT "job_order_output_classification_id_output_classification_id_fk" FOREIGN KEY ("classification_id") REFERENCES "public"."output_classification"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order_output" ADD CONSTRAINT "job_order_output_lot_id_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lot"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order_output" ADD CONSTRAINT "job_order_output_location_id_store_section_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."store_section"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order_output" ADD CONSTRAINT "job_order_output_coffee_grade_id_coffee_grade_id_fk" FOREIGN KEY ("coffee_grade_id") REFERENCES "public"."coffee_grade"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "job_order_status_history" ADD CONSTRAINT "job_order_status_history_job_order_id_job_order_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_order"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "job_production_log" ADD CONSTRAINT "job_production_log_job_order_id_job_order_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_order"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "processing_request" ADD CONSTRAINT "processing_request_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "processing_request" ADD CONSTRAINT "processing_request_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "processing_request" ADD CONSTRAINT "processing_request_consignment_id_consignment_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignment"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "processing_request" ADD CONSTRAINT "processing_request_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE no action ON UPDATE no action;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX "uq_job_order__reference" ON "job_order" USING btree ("reference");
CREATE INDEX "idx_job_order__consignment" ON "job_order" USING btree ("consignment_id");
CREATE INDEX "idx_job_order__customer" ON "job_order" USING btree ("customer_id","created_at");
CREATE INDEX "idx_job_order__status" ON "job_order" USING btree ("status");
CREATE INDEX "idx_job_order__machine_day" ON "job_order" USING btree ("machine_id","scheduled_start_at");
CREATE INDEX "idx_job_order__running" ON "job_order" USING btree ("started_at") WHERE "job_order"."status" in ('RELEASED','IN_PROGRESS','PAUSED');
CREATE UNIQUE INDEX "uq_job_order_input__no" ON "job_order_input" USING btree ("job_order_id","line_no");
CREATE INDEX "idx_job_order_input__job" ON "job_order_input" USING btree ("job_order_id");
CREATE INDEX "idx_job_order_input__lot" ON "job_order_input" USING btree ("lot_id");
CREATE UNIQUE INDEX "uq_job_order_output__no" ON "job_order_output" USING btree ("job_order_id","line_no");
CREATE INDEX "idx_job_order_output__job" ON "job_order_output" USING btree ("job_order_id");
CREATE INDEX "idx_job_order_output__lot" ON "job_order_output" USING btree ("lot_id");
CREATE INDEX "idx_job_order_status_history__job" ON "job_order_status_history" USING btree ("job_order_id","changed_at");
CREATE INDEX "idx_job_production_log__job" ON "job_production_log" USING btree ("job_order_id","logged_on");
CREATE UNIQUE INDEX "uq_processing_request__reference" ON "processing_request" USING btree ("reference");
CREATE INDEX "idx_processing_request__customer" ON "processing_request" USING btree ("customer_id","created_at");
CREATE INDEX "idx_processing_request__status" ON "processing_request" USING btree ("status");
CREATE INDEX "idx_processing_request__consignment" ON "processing_request" USING btree ("consignment_id");

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'processing_request','job_order','job_order_input','job_order_output'
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
    'job_production_log','job_order_status_history'
  ] LOOP
    PERFORM public.fn_attach_append_only(t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

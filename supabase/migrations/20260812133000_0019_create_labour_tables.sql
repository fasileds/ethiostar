-- 20260812133000_0019_create_labour_tables.sql
-- phase:      1
-- module:     M18 Labour & Workforce Management
-- ticket:     CPMS-019
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- Pay is CALCULATED from an approved output against a dated rate, never typed, and the
-- rate used is copied onto the output row. ck_labour_output__approved_is_priced refuses
-- to approve an unvalued row — that is what makes a payroll dispute resolvable.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE "labour_attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"worker_id" uuid NOT NULL,
	"crew_id" uuid,
	"attendance_on" date NOT NULL,
	"shift_id" uuid,
	"check_in_at" timestamp with time zone,
	"check_out_at" timestamp with time zone,
	"status" text DEFAULT 'PRESENT' NOT NULL,
	"hours_worked" numeric(14, 2),
	"absence_reason" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_labour_attendance__status" CHECK ("labour_attendance"."status" in ('PRESENT','ABSENT','LATE','HALF_DAY','LEAVE')),
	CONSTRAINT "ck_labour_attendance__times" CHECK ("labour_attendance"."check_out_at" is null or "labour_attendance"."check_in_at" is null or "labour_attendance"."check_out_at" >= "labour_attendance"."check_in_at")
);

CREATE TABLE "labour_crew" (
	"id" uuid PRIMARY KEY NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"supervisor_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "labour_crew_member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"crew_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"joined_on" date NOT NULL,
	"left_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL
);

CREATE TABLE "labour_output" (
	"id" uuid PRIMARY KEY NOT NULL,
	"worker_id" uuid NOT NULL,
	"crew_id" uuid,
	"job_order_id" uuid,
	"activity_type_id" uuid NOT NULL,
	"produced_on" date NOT NULL,
	"shift_id" uuid,
	"quantity_kg" numeric(14, 3),
	"kesha_count" integer,
	"hours_worked" numeric(14, 2),
	"rate_id" uuid,
	"rate_basis" text,
	"rate_amount" numeric(14, 2),
	"calculated_amount" numeric(14, 2),
	"currency" char(3) DEFAULT 'ETB',
	"status" text DEFAULT 'RECORDED' NOT NULL,
	"recorded_by" uuid NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"is_disputed" boolean DEFAULT false NOT NULL,
	"dispute_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_labour_output__status" CHECK ("labour_output"."status" in ('RECORDED','APPROVED','PAID','REJECTED')),
	CONSTRAINT "ck_labour_output__has_quantity" CHECK ("labour_output"."quantity_kg" is not null or "labour_output"."kesha_count" is not null or "labour_output"."hours_worked" is not null),
	CONSTRAINT "ck_labour_output__approved_is_priced" CHECK ("labour_output"."status" not in ('APPROVED','PAID') or ("labour_output"."rate_amount" is not null and "labour_output"."calculated_amount" is not null))
);

CREATE TABLE "labour_payroll_period" (
	"id" uuid PRIMARY KEY NOT NULL,
	"branch_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"period_start_on" date NOT NULL,
	"period_end_on" date NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"worker_count" integer DEFAULT 0 NOT NULL,
	"total_amount" numeric(14, 2),
	"currency" char(3) DEFAULT 'ETB',
	"calculated_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_labour_payroll_period__status" CHECK ("labour_payroll_period"."status" in ('OPEN','CALCULATED','APPROVED','CLOSED')),
	CONSTRAINT "ck_labour_payroll_period__range" CHECK ("labour_payroll_period"."period_end_on" >= "labour_payroll_period"."period_start_on")
);

CREATE TABLE "labour_rate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"branch_id" uuid NOT NULL,
	"activity_type_id" uuid NOT NULL,
	"rate_basis" text NOT NULL,
	"rate_amount" numeric(14, 2) NOT NULL,
	"currency" char(3) DEFAULT 'ETB',
	"effective_from" date NOT NULL,
	"effective_to" date,
	"approved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_labour_rate__basis" CHECK ("labour_rate"."rate_basis" in ('PER_KG','PER_KESHA','PER_DAY','PER_HOUR')),
	CONSTRAINT "ck_labour_rate__amount" CHECK ("labour_rate"."rate_amount" >= 0),
	CONSTRAINT "ck_labour_rate__period" CHECK ("labour_rate"."effective_to" is null or "labour_rate"."effective_to" >= "labour_rate"."effective_from")
);

CREATE TABLE "labour_worker" (
	"id" uuid PRIMARY KEY NOT NULL,
	"branch_id" uuid NOT NULL,
	"worker_code" text NOT NULL,
	"full_name" text NOT NULL,
	"full_name_am" text,
	"gender" text,
	"phone" text,
	"id_document_no" text,
	"engagement_type" text DEFAULT 'DAILY' NOT NULL,
	"default_activity_type_id" uuid,
	"engaged_on" date,
	"released_on" date,
	"bank_account_no" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_labour_worker__engagement" CHECK ("labour_worker"."engagement_type" in ('DAILY','CONTRACT','PERMANENT'))
);

-- ═════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "labour_attendance" ADD CONSTRAINT "labour_attendance_worker_id_labour_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."labour_worker"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_attendance" ADD CONSTRAINT "labour_attendance_crew_id_labour_crew_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."labour_crew"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_attendance" ADD CONSTRAINT "labour_attendance_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_crew" ADD CONSTRAINT "labour_crew_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_crew_member" ADD CONSTRAINT "labour_crew_member_crew_id_labour_crew_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."labour_crew"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "labour_crew_member" ADD CONSTRAINT "labour_crew_member_worker_id_labour_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."labour_worker"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_output" ADD CONSTRAINT "labour_output_worker_id_labour_worker_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."labour_worker"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_output" ADD CONSTRAINT "labour_output_crew_id_labour_crew_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."labour_crew"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_output" ADD CONSTRAINT "labour_output_job_order_id_job_order_id_fk" FOREIGN KEY ("job_order_id") REFERENCES "public"."job_order"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_output" ADD CONSTRAINT "labour_output_activity_type_id_labour_activity_type_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."labour_activity_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_output" ADD CONSTRAINT "labour_output_shift_id_shift_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shift"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_output" ADD CONSTRAINT "labour_output_rate_id_labour_rate_id_fk" FOREIGN KEY ("rate_id") REFERENCES "public"."labour_rate"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_payroll_period" ADD CONSTRAINT "labour_payroll_period_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_rate" ADD CONSTRAINT "labour_rate_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_rate" ADD CONSTRAINT "labour_rate_activity_type_id_labour_activity_type_id_fk" FOREIGN KEY ("activity_type_id") REFERENCES "public"."labour_activity_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_worker" ADD CONSTRAINT "labour_worker_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "labour_worker" ADD CONSTRAINT "labour_worker_default_activity_type_id_labour_activity_type_id_fk" FOREIGN KEY ("default_activity_type_id") REFERENCES "public"."labour_activity_type"("id") ON DELETE no action ON UPDATE no action;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX "uq_labour_attendance__day" ON "labour_attendance" USING btree ("worker_id","attendance_on","shift_id");
CREATE INDEX "idx_labour_attendance__day" ON "labour_attendance" USING btree ("attendance_on","status");
CREATE INDEX "idx_labour_attendance__crew" ON "labour_attendance" USING btree ("crew_id","attendance_on");
CREATE UNIQUE INDEX "uq_labour_crew__code" ON "labour_crew" USING btree ("code");
CREATE INDEX "idx_labour_crew__branch" ON "labour_crew" USING btree ("branch_id");
CREATE UNIQUE INDEX "uq_labour_crew_member__current" ON "labour_crew_member" USING btree ("worker_id") WHERE "labour_crew_member"."left_on" is null;
CREATE INDEX "idx_labour_crew_member__crew" ON "labour_crew_member" USING btree ("crew_id");
CREATE INDEX "idx_labour_output__worker" ON "labour_output" USING btree ("worker_id","produced_on");
CREATE INDEX "idx_labour_output__job" ON "labour_output" USING btree ("job_order_id");
CREATE INDEX "idx_labour_output__day" ON "labour_output" USING btree ("produced_on","status");
CREATE INDEX "idx_labour_output__approval" ON "labour_output" USING btree ("produced_on") WHERE "labour_output"."status" = 'RECORDED';
CREATE UNIQUE INDEX "uq_labour_payroll_period__reference" ON "labour_payroll_period" USING btree ("reference");
CREATE INDEX "idx_labour_payroll_period__range" ON "labour_payroll_period" USING btree ("branch_id","period_start_on");
CREATE INDEX "idx_labour_rate__lookup" ON "labour_rate" USING btree ("activity_type_id","branch_id","effective_from");
CREATE UNIQUE INDEX "uq_labour_worker__code" ON "labour_worker" USING btree ("worker_code");
CREATE INDEX "idx_labour_worker__branch" ON "labour_worker" USING btree ("branch_id","is_active");
CREATE INDEX "idx_labour_worker__name" ON "labour_worker" USING btree ("full_name");

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'labour_worker','labour_crew','labour_crew_member','labour_rate','labour_attendance','labour_output','labour_payroll_period'
  ] LOOP
    PERFORM public.fn_attach_standard_triggers(t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- 20260812125000_0015_create_scheduling_tables.sql
-- phase:      1
-- module:     M14 Processing Appointment Scheduling
-- ticket:     CPMS-015
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- appointment.sequence_no orders bookings within a machine-day; it is what the delay
-- cascade walks. The partial unique index excludes cancelled and rescheduled rows so a
-- cancelled slot keeps its number without blocking the position.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE "appointment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"consignment_id" uuid,
	"machine_id" uuid NOT NULL,
	"scheduled_on" date NOT NULL,
	"scheduled_start_at" timestamp with time zone NOT NULL,
	"scheduled_end_at" timestamp with time zone NOT NULL,
	"sequence_no" integer NOT NULL,
	"planned_quantity_kg" numeric(14, 3) NOT NULL,
	"planned_kesha_count" integer,
	"estimated_hours" numeric(6, 3),
	"status" text DEFAULT 'REQUESTED' NOT NULL,
	"rescheduled_from_at" timestamp with time zone,
	"reschedule_reason" text,
	"cumulative_delay_minutes" integer DEFAULT 0 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"customer_notified_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_appointment__status" CHECK ("appointment"."status" in ('REQUESTED','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW','RESCHEDULED')),
	CONSTRAINT "ck_appointment__window" CHECK ("appointment"."scheduled_end_at" > "appointment"."scheduled_start_at"),
	CONSTRAINT "ck_appointment__quantity" CHECK ("appointment"."planned_quantity_kg" > 0)
);

CREATE TABLE "appointment_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"appointment_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid
);

CREATE TABLE "machine" (
	"id" uuid PRIMARY KEY NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_am" text,
	"machine_type" text NOT NULL,
	"manufacturer" text,
	"model_no" text,
	"serial_no" text,
	"commissioned_on" date,
	"rated_capacity_kg_per_hour" numeric(14, 3) NOT NULL,
	"efficiency_factor" numeric(6, 3) DEFAULT '0.850' NOT NULL,
	"status" text DEFAULT 'AVAILABLE' NOT NULL,
	"status_note" text,
	"last_maintenance_on" date,
	"next_maintenance_on" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_machine__status" CHECK ("machine"."status" in ('AVAILABLE','RUNNING','MAINTENANCE','BREAKDOWN','RETIRED')),
	CONSTRAINT "ck_machine__capacity" CHECK ("machine"."rated_capacity_kg_per_hour" > 0),
	CONSTRAINT "ck_machine__efficiency" CHECK ("machine"."efficiency_factor" > 0 and "machine"."efficiency_factor" <= 1)
);

CREATE TABLE "machine_capacity_day" (
	"id" uuid PRIMARY KEY NOT NULL,
	"machine_id" uuid NOT NULL,
	"capacity_on" date NOT NULL,
	"available_hours" numeric(6, 3) DEFAULT '8.000' NOT NULL,
	"capacity_kg" numeric(14, 3) NOT NULL,
	"capacity_kesha" integer,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"blocked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_machine_capacity_day__capacity" CHECK ("machine_capacity_day"."capacity_kg" >= 0),
	CONSTRAINT "ck_machine_capacity_day__blocked_reason" CHECK (not "machine_capacity_day"."is_blocked" or "machine_capacity_day"."blocked_reason" is not null)
);

CREATE TABLE "schedule_delay" (
	"id" uuid PRIMARY KEY NOT NULL,
	"machine_id" uuid NOT NULL,
	"appointment_id" uuid,
	"occurred_on" date NOT NULL,
	"delay_minutes" integer NOT NULL,
	"cause_code" text NOT NULL,
	"description" text,
	"affected_appointments" integer DEFAULT 0 NOT NULL,
	"reported_by" uuid NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_schedule_delay__minutes" CHECK ("schedule_delay"."delay_minutes" > 0)
);

-- ═════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_consignment_id_consignment_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignment"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "machine" ADD CONSTRAINT "machine_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "machine_capacity_day" ADD CONSTRAINT "machine_capacity_day_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "schedule_delay" ADD CONSTRAINT "schedule_delay_machine_id_machine_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machine"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "schedule_delay" ADD CONSTRAINT "schedule_delay_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE no action ON UPDATE no action;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX "uq_appointment__reference" ON "appointment" USING btree ("reference");
CREATE UNIQUE INDEX "uq_appointment__slot" ON "appointment" USING btree ("machine_id","scheduled_on","sequence_no") WHERE "appointment"."status" not in ('CANCELLED','NO_SHOW','RESCHEDULED');
CREATE INDEX "idx_appointment__day" ON "appointment" USING btree ("scheduled_on","machine_id");
CREATE INDEX "idx_appointment__customer" ON "appointment" USING btree ("customer_id","scheduled_on");
CREATE INDEX "idx_appointment__consignment" ON "appointment" USING btree ("consignment_id");
CREATE INDEX "idx_appointment__status" ON "appointment" USING btree ("status","scheduled_on");
CREATE INDEX "idx_appointment_status_history__appointment" ON "appointment_status_history" USING btree ("appointment_id","changed_at");
CREATE UNIQUE INDEX "uq_machine__code" ON "machine" USING btree ("code");
CREATE INDEX "idx_machine__branch" ON "machine" USING btree ("branch_id","status");
CREATE UNIQUE INDEX "uq_machine_capacity_day__pair" ON "machine_capacity_day" USING btree ("machine_id","capacity_on");
CREATE INDEX "idx_machine_capacity_day__date" ON "machine_capacity_day" USING btree ("capacity_on");
CREATE INDEX "idx_schedule_delay__machine" ON "schedule_delay" USING btree ("machine_id","occurred_on");
CREATE INDEX "idx_schedule_delay__cause" ON "schedule_delay" USING btree ("cause_code","occurred_on");

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'machine','machine_capacity_day','appointment','schedule_delay'
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
    'appointment_status_history'
  ] LOOP
    PERFORM public.fn_attach_append_only(t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

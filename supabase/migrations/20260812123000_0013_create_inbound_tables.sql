-- 20260812123000_0013_create_inbound_tables.sql
-- phase:      1
-- module:     M11 Inbound Coffee Reception
-- ticket:     CPMS-013
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- The GOODS RECEIPT is what creates stock — not the request, not the gate pass.
-- ck_goods_receipt__posted_has_location is the M12 key control ('every kilogram is at
-- a defined location') expressed at the point where stock comes into existence.
--
-- This migration also closes two forward references left open since 0005 and 0011.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Tables
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE "delivery_request" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"coffee_type_id" uuid,
	"coffee_grade_id" uuid,
	"origin_woreda_id" uuid,
	"harvest_year_id" uuid,
	"bag_type_id" uuid,
	"declared_quantity_kg" numeric(14, 3) NOT NULL,
	"declared_kesha_count" integer NOT NULL,
	"expected_arrival_on" date NOT NULL,
	"expected_arrival_window" text,
	"transport_mode" text,
	"vehicle_plate" text,
	"driver_name" text,
	"driver_phone" text,
	"request_letter_file_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"reservation_id" uuid,
	"consignment_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_delivery_request__status" CHECK ("delivery_request"."status" in ('DRAFT','SUBMITTED','APPROVED','REJECTED','SCHEDULED','ARRIVED','RECEIVED','CANCELLED')),
	CONSTRAINT "ck_delivery_request__quantity" CHECK ("delivery_request"."declared_quantity_kg" > 0),
	CONSTRAINT "ck_delivery_request__kesha" CHECK ("delivery_request"."declared_kesha_count" > 0)
);

CREATE TABLE "delivery_request_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"delivery_request_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"note" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid
);

CREATE TABLE "gate_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"branch_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"vehicle_plate" text NOT NULL,
	"driver_name" text,
	"driver_id_no" text,
	"gate_pass_id" uuid,
	"dispatch_order_id" uuid,
	"delivery_request_id" uuid,
	"capture_method" text DEFAULT 'SCAN' NOT NULL,
	"manual_reason" text,
	"guard_note" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ck_gate_event__direction" CHECK ("gate_event"."direction" in ('IN','OUT')),
	CONSTRAINT "ck_gate_event__capture" CHECK ("gate_event"."capture_method" in ('SCAN','MANUAL')),
	CONSTRAINT "ck_gate_event__manual_reason" CHECK ("gate_event"."capture_method" <> 'MANUAL' or "gate_event"."manual_reason" is not null)
);

CREATE TABLE "gate_pass" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"delivery_request_id" uuid NOT NULL,
	"scan_token" text NOT NULL,
	"valid_on" date NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"vehicle_plate" text,
	"driver_name" text,
	"status" text DEFAULT 'ISSUED' NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_gate_pass__status" CHECK ("gate_pass"."status" in ('ISSUED','USED','EXPIRED','REVOKED'))
);

CREATE TABLE "goods_receipt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"consignment_id" uuid NOT NULL,
	"delivery_request_id" uuid,
	"customer_id" uuid NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"weighbridge_ticket_id" uuid,
	"vehicle_plate" text,
	"driver_name" text,
	"received_quantity_kg" numeric(14, 3) NOT NULL,
	"received_kesha_count" integer NOT NULL,
	"declared_quantity_kg" numeric(14, 3),
	"declared_kesha_count" integer,
	"variance_kg" numeric(14, 3),
	"variance_pct" numeric(6, 3),
	"tolerance_applied_pct" numeric(6, 3),
	"variance_approved_by" uuid,
	"variance_approved_at" timestamp with time zone,
	"variance_reason" text,
	"location_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid NOT NULL,
	"customer_rep_name" text,
	"customer_signature_file_id" uuid,
	"posted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_goods_receipt__status" CHECK ("goods_receipt"."status" in ('DRAFT','CONFIRMED','POSTED','CANCELLED')),
	CONSTRAINT "ck_goods_receipt__quantity" CHECK ("goods_receipt"."received_quantity_kg" > 0),
	CONSTRAINT "ck_goods_receipt__kesha" CHECK ("goods_receipt"."received_kesha_count" > 0),
	CONSTRAINT "ck_goods_receipt__posted_has_location" CHECK ("goods_receipt"."status" <> 'POSTED' or "goods_receipt"."location_id" is not null)
);

CREATE TABLE "goods_receipt_line" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receipt_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"bag_type_id" uuid,
	"coffee_type_id" uuid,
	"coffee_grade_id" uuid,
	"quantity_kg" numeric(14, 3) NOT NULL,
	"kesha_count" integer NOT NULL,
	"location_id" uuid,
	"lot_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_goods_receipt_line__quantity" CHECK ("goods_receipt_line"."quantity_kg" > 0),
	CONSTRAINT "ck_goods_receipt_line__kesha" CHECK ("goods_receipt_line"."kesha_count" > 0)
);

CREATE TABLE "quality_inspection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"receipt_id" uuid,
	"consignment_id" uuid,
	"moisture_pct" numeric(6, 3),
	"defect_count" integer,
	"screen_size_note" text,
	"appearance" text,
	"foreign_matter_pct" numeric(6, 3),
	"cup_score" numeric(6, 3),
	"verdict" text DEFAULT 'PASS' NOT NULL,
	"inspector_note" text,
	"inspected_by" uuid NOT NULL,
	"inspected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_quality_inspection__verdict" CHECK ("quality_inspection"."verdict" in ('PASS','PASS_WITH_NOTE','FLAGGED')),
	CONSTRAINT "ck_quality_inspection__moisture" CHECK ("quality_inspection"."moisture_pct" is null or ("quality_inspection"."moisture_pct" >= 0 and "quality_inspection"."moisture_pct" <= 100))
);

CREATE TABLE "weighbridge_ticket" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_no" text NOT NULL,
	"delivery_request_id" uuid,
	"vehicle_plate" text NOT NULL,
	"gross_weight_kg" numeric(14, 3) NOT NULL,
	"tare_weight_kg" numeric(14, 3) NOT NULL,
	"net_weight_kg" numeric(14, 3) GENERATED ALWAYS AS (gross_weight_kg - tare_weight_kg) STORED,
	"weighed_in_at" timestamp with time zone NOT NULL,
	"weighed_out_at" timestamp with time zone,
	"capture_method" text DEFAULT 'MANUAL' NOT NULL,
	"scale_id" text,
	"operator_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_weighbridge_ticket__gross" CHECK ("weighbridge_ticket"."gross_weight_kg" > 0),
	CONSTRAINT "ck_weighbridge_ticket__tare" CHECK ("weighbridge_ticket"."tare_weight_kg" >= 0),
	CONSTRAINT "ck_weighbridge_ticket__net" CHECK ("weighbridge_ticket"."gross_weight_kg" > "weighbridge_ticket"."tare_weight_kg"),
	CONSTRAINT "ck_weighbridge_ticket__capture" CHECK ("weighbridge_ticket"."capture_method" in ('MANUAL','DEVICE'))
);

-- ═════════════════════════════════════════════════════════════════════════
-- Foreign keys
-- ═════════════════════════════════════════════════════════════════════════
ALTER TABLE "delivery_request" ADD CONSTRAINT "delivery_request_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "delivery_request" ADD CONSTRAINT "delivery_request_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "delivery_request" ADD CONSTRAINT "delivery_request_coffee_type_id_coffee_type_id_fk" FOREIGN KEY ("coffee_type_id") REFERENCES "public"."coffee_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "delivery_request" ADD CONSTRAINT "delivery_request_coffee_grade_id_coffee_grade_id_fk" FOREIGN KEY ("coffee_grade_id") REFERENCES "public"."coffee_grade"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "delivery_request" ADD CONSTRAINT "delivery_request_origin_woreda_id_woreda_id_fk" FOREIGN KEY ("origin_woreda_id") REFERENCES "public"."woreda"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "delivery_request" ADD CONSTRAINT "delivery_request_harvest_year_id_harvest_year_id_fk" FOREIGN KEY ("harvest_year_id") REFERENCES "public"."harvest_year"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "delivery_request" ADD CONSTRAINT "delivery_request_bag_type_id_bag_type_id_fk" FOREIGN KEY ("bag_type_id") REFERENCES "public"."bag_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "delivery_request" ADD CONSTRAINT "delivery_request_request_letter_file_id_stored_file_id_fk" FOREIGN KEY ("request_letter_file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "delivery_request" ADD CONSTRAINT "delivery_request_consignment_id_consignment_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignment"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "delivery_request_status_history" ADD CONSTRAINT "delivery_request_status_history_delivery_request_id_delivery_request_id_fk" FOREIGN KEY ("delivery_request_id") REFERENCES "public"."delivery_request"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "gate_event" ADD CONSTRAINT "gate_event_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "gate_event" ADD CONSTRAINT "gate_event_gate_pass_id_gate_pass_id_fk" FOREIGN KEY ("gate_pass_id") REFERENCES "public"."gate_pass"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "gate_event" ADD CONSTRAINT "gate_event_delivery_request_id_delivery_request_id_fk" FOREIGN KEY ("delivery_request_id") REFERENCES "public"."delivery_request"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "gate_pass" ADD CONSTRAINT "gate_pass_delivery_request_id_delivery_request_id_fk" FOREIGN KEY ("delivery_request_id") REFERENCES "public"."delivery_request"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_consignment_id_consignment_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignment"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_delivery_request_id_delivery_request_id_fk" FOREIGN KEY ("delivery_request_id") REFERENCES "public"."delivery_request"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_customer_id_customer_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customer"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_weighbridge_ticket_id_weighbridge_ticket_id_fk" FOREIGN KEY ("weighbridge_ticket_id") REFERENCES "public"."weighbridge_ticket"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_location_id_store_section_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."store_section"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt" ADD CONSTRAINT "goods_receipt_customer_signature_file_id_stored_file_id_fk" FOREIGN KEY ("customer_signature_file_id") REFERENCES "public"."stored_file"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_receipt_id_goods_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipt"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_bag_type_id_bag_type_id_fk" FOREIGN KEY ("bag_type_id") REFERENCES "public"."bag_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_coffee_type_id_coffee_type_id_fk" FOREIGN KEY ("coffee_type_id") REFERENCES "public"."coffee_type"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_coffee_grade_id_coffee_grade_id_fk" FOREIGN KEY ("coffee_grade_id") REFERENCES "public"."coffee_grade"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_location_id_store_section_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."store_section"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "goods_receipt_line" ADD CONSTRAINT "goods_receipt_line_lot_id_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lot"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_receipt_id_goods_receipt_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipt"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "quality_inspection" ADD CONSTRAINT "quality_inspection_consignment_id_consignment_id_fk" FOREIGN KEY ("consignment_id") REFERENCES "public"."consignment"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "weighbridge_ticket" ADD CONSTRAINT "weighbridge_ticket_delivery_request_id_delivery_request_id_fk" FOREIGN KEY ("delivery_request_id") REFERENCES "public"."delivery_request"("id") ON DELETE no action ON UPDATE no action;

-- Deferred since 0005: capacity_reservation could not point at a table that did not exist.

ALTER TABLE "capacity_reservation" ADD CONSTRAINT "capacity_reservation_delivery_request_id_delivery_request_id_fk" FOREIGN KEY ("delivery_request_id") REFERENCES "public"."delivery_request"("id") ON DELETE no action ON UPDATE no action;

-- Deferred since 0011: the consignment spine predates the request that feeds it.

ALTER TABLE "consignment" ADD CONSTRAINT "consignment_delivery_request_id_delivery_request_id_fk" FOREIGN KEY ("delivery_request_id") REFERENCES "public"."delivery_request"("id") ON DELETE no action ON UPDATE no action;

ALTER TABLE "delivery_request" ADD CONSTRAINT "delivery_request_reservation_id_capacity_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."capacity_reservation"("id") ON DELETE no action ON UPDATE no action;

-- ═════════════════════════════════════════════════════════════════════════
-- Indexes
-- ═════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX "uq_delivery_request__reference" ON "delivery_request" USING btree ("reference");
CREATE INDEX "idx_delivery_request__customer" ON "delivery_request" USING btree ("customer_id","created_at");
CREATE INDEX "idx_delivery_request__status" ON "delivery_request" USING btree ("status","expected_arrival_on");
CREATE INDEX "idx_delivery_request__branch" ON "delivery_request" USING btree ("branch_id");
CREATE INDEX "idx_delivery_request__consignment" ON "delivery_request" USING btree ("consignment_id");
CREATE INDEX "idx_delivery_request__pending" ON "delivery_request" USING btree ("expected_arrival_on") WHERE "delivery_request"."status" = 'SUBMITTED';
CREATE INDEX "idx_delivery_request_status_history__request" ON "delivery_request_status_history" USING btree ("delivery_request_id","changed_at");
CREATE INDEX "idx_gate_event__branch_time" ON "gate_event" USING btree ("branch_id","occurred_at");
CREATE INDEX "idx_gate_event__plate" ON "gate_event" USING btree ("vehicle_plate","occurred_at");
CREATE INDEX "idx_gate_event__pass" ON "gate_event" USING btree ("gate_pass_id");
CREATE UNIQUE INDEX "uq_gate_pass__reference" ON "gate_pass" USING btree ("reference");
CREATE UNIQUE INDEX "uq_gate_pass__scan_token" ON "gate_pass" USING btree ("scan_token");
CREATE INDEX "idx_gate_pass__request" ON "gate_pass" USING btree ("delivery_request_id");
CREATE INDEX "idx_gate_pass__valid_on" ON "gate_pass" USING btree ("valid_on","status");
CREATE UNIQUE INDEX "uq_goods_receipt__reference" ON "goods_receipt" USING btree ("reference");
CREATE INDEX "idx_goods_receipt__consignment" ON "goods_receipt" USING btree ("consignment_id");
CREATE INDEX "idx_goods_receipt__customer" ON "goods_receipt" USING btree ("customer_id","occurred_at");
CREATE INDEX "idx_goods_receipt__status" ON "goods_receipt" USING btree ("status");
CREATE INDEX "idx_goods_receipt__occurred" ON "goods_receipt" USING btree ("occurred_at");
CREATE UNIQUE INDEX "uq_goods_receipt_line__no" ON "goods_receipt_line" USING btree ("receipt_id","line_no");
CREATE INDEX "idx_goods_receipt_line__receipt" ON "goods_receipt_line" USING btree ("receipt_id");
CREATE INDEX "idx_goods_receipt_line__lot" ON "goods_receipt_line" USING btree ("lot_id");
CREATE INDEX "idx_quality_inspection__receipt" ON "quality_inspection" USING btree ("receipt_id");
CREATE INDEX "idx_quality_inspection__consignment" ON "quality_inspection" USING btree ("consignment_id");
CREATE UNIQUE INDEX "uq_weighbridge_ticket__no" ON "weighbridge_ticket" USING btree ("ticket_no");
CREATE INDEX "idx_weighbridge_ticket__request" ON "weighbridge_ticket" USING btree ("delivery_request_id");

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'delivery_request','gate_pass','weighbridge_ticket','goods_receipt','goods_receipt_line','quality_inspection'
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
    'gate_event','delivery_request_status_history'
  ] LOOP
    PERFORM public.fn_attach_append_only(t);
    EXECUTE format('GRANT SELECT, INSERT ON public.%I TO authenticated', t);
  END LOOP;
END $$;

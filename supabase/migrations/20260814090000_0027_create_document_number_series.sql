-- 20260814090000_0027_create_document_number_series.sql
-- phase:      1
-- module:     M06 Printing, Labelling & Barcode / QR — gapless document numbering
-- ticket:     CPMS-027
-- breaking:   no
-- lock-risk:  none   (new table only)
-- rollback:   forward-fix only
--
-- WHY THIS FILE EXISTS
--
-- `src/config/constants.ts` declares DOCUMENT_SERIES (GRN, GP, MIRT, …) and roadmap Step 12
-- specifies `document_number_series`, but no migration ever created the table. Without it
-- M06's key control — "every printed document carries a system-generated number" — has
-- nowhere to allocate from, and every one of the eighteen operational documents in §7.1 is
-- unprintable.
--
-- WHY ALLOCATION IS A ROW LOCK AND NOT A SEQUENCE
--
-- A Postgres sequence is explicitly NOT transactional: nextval() outside a transaction's
-- control means a rolled-back goods receipt still burns GRN-2026-000045, leaving a hole in
-- the numbering. For a document that is a legal artefact in a custody dispute, a gap is a
-- question EthioStar cannot answer — "where is GRN 45?" has no good response.
--
-- So allocation is `UPDATE … SET next_value = next_value + 1 RETURNING` inside the caller's
-- transaction. That takes a row lock for the remainder of the transaction, serialising
-- concurrent allocations of the SAME series, which is precisely the guarantee wanted. The
-- lock is per (series, branch, year), so a goods receipt and a gate pass never block one
-- another.
--
-- docs/adr/0012-pdf-rendering.md, roadmap Step 12

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═════════════════════════════════════════════════════════════════════════
-- Table
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE "document_number_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	-- One of the DOCUMENT_SERIES codes in src/config/constants.ts.
	"series_code" text NOT NULL,
	-- Numbering is per branch where a branch is given. NULL means one global series, which
	-- is what a single-site deployment wants.
	"branch_id" uuid REFERENCES "branch"("id"),
	-- Reset scope. Ethiopian operations reference documents by year constantly ("the GRN
	-- from last season"), so the year is part of the identity rather than a formatting
	-- detail applied at render time.
	"reset_year" integer NOT NULL,
	"prefix" text NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	-- Zero-padding width. Six digits carries a site to 999,999 documents in a year.
	"padding" integer DEFAULT 6 NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "ck_document_number_series__next_value"
		CHECK ("document_number_series"."next_value" >= 1),
	CONSTRAINT "ck_document_number_series__padding"
		CHECK ("document_number_series"."padding" BETWEEN 1 AND 12),
	CONSTRAINT "ck_document_number_series__reset_year"
		CHECK ("document_number_series"."reset_year" BETWEEN 2000 AND 2200)
);

-- NULLS NOT DISTINCT is load-bearing. With the default (NULLS DISTINCT) two rows with a
-- NULL branch_id would both be allowed for the same series and year, and the allocator's
-- `UPDATE … WHERE branch_id IS NULL` would then update both — issuing the same number twice.
CREATE UNIQUE INDEX "uq_document_number_series__key"
	ON "document_number_series" ("series_code", "branch_id", "reset_year") NULLS NOT DISTINCT;

CREATE INDEX "idx_document_number_series__active"
	ON "document_number_series" ("series_code", "is_active");

COMMENT ON TABLE "document_number_series" IS
	'M06 gapless document numbering. Allocated by row lock inside the caller''s transaction so a rollback does not consume a number.';

COMMENT ON COLUMN "document_number_series"."next_value" IS
	'The NEXT number to issue. Allocation returns this value and increments it in the same statement.';

-- ═════════════════════════════════════════════════════════════════════════
-- Triggers, RLS and grants
-- ═════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  PERFORM public.fn_attach_standard_triggers('document_number_series');
END $$;

ALTER TABLE "document_number_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_number_series" FORCE ROW LEVEL SECURITY;

-- Staff only, like every other M06 table. A customer never allocates a document number;
-- the documents they see are rendered server-side from an already-allocated one.
CREATE POLICY p_document_number_series__staff ON public.document_number_series
	FOR ALL TO authenticated
	USING (public.fn_is_staff()) WITH CHECK (public.fn_is_staff());

-- No DELETE. Removing a series would let the next allocation restart at 1 and reissue
-- numbers that are already on paper in a customer's file.
GRANT SELECT, INSERT, UPDATE ON public.document_number_series TO authenticated;

-- 20260814100000_0029_printed_document_customer_access.sql
-- phase:      1
-- module:     M06 Printing — customer access to their own printed documents
-- ticket:     CPMS-029
-- breaking:   no
-- lock-risk:  low   (ADD COLUMN with no default, plus one new index and one new policy)
-- rollback:   forward-fix only
--
-- WHY THIS FILE EXISTS
--
-- Migration 0022 made `printed_document` staff-only ON PURPOSE: "a polymorphic
-- source_type/source_id policy would be both unreadable and only as correct as its longest
-- branch." That decision was correct for a generic RLS predicate, but it also means a
-- customer's own transaction — run under their own claims via `printed_document p`'s
-- unfiltered SELECT in `recentPrints` — returns zero rows today. The portal Documents page
-- has been listing nothing for every customer since the day it shipped.
--
-- The fix kept in the spirit of 0022's own reasoning: add ONE flat, non-polymorphic
-- `customer_id` column, populated once at print time by the application (which already knows
-- which customer a goods receipt, gate pass or Mirt Merekebiya belongs to), and gate customer
-- access on a plain equality check — not a join across eighteen different source tables.

SET lock_timeout = '5s';
SET statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- Column
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "printed_document"
  ADD COLUMN "customer_id" uuid REFERENCES "customer"("id");

CREATE INDEX "idx_printed_document__customer" ON "printed_document" ("customer_id", "printed_at");

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — additive customer SELECT policy
-- ═══════════════════════════════════════════════════════════════════════════
-- The existing `p_printed_document__staff` policy (migration 0022) is untouched: staff keep
-- full access. This adds a second, narrower policy so Postgres OR's them together — a
-- customer sees exactly the rows that are theirs, nothing else, and cannot write.

CREATE POLICY "p_printed_document__customer" ON "printed_document"
  FOR SELECT TO authenticated
  USING (public.fn_owns_customer(customer_id));

-- `document_verification` stays staff-only (migration 0022) and is not queried by customers —
-- the public /scan/[token] page is unauthenticated and reads/writes it through the sanctioned
-- service-role path in modules/printing/infrastructure/system/, exactly like the credential
-- issue and outbox relay call sites documented in docs/adr/0013.

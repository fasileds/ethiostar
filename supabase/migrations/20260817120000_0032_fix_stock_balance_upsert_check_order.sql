-- ═══════════════════════════════════════════════════════════════════════════
-- Fix fn_apply_stock_movement(): CHECK constraints run on the speculative INSERT
-- row BEFORE conflict resolution, so ON CONFLICT DO UPDATE never gets a chance
-- ═══════════════════════════════════════════════════════════════════════════
-- PostgreSQL evaluates CHECK constraints against the RAW incoming row of an
-- `INSERT ... ON CONFLICT DO UPDATE` as part of the initial (speculative) insert
-- attempt, before it has determined whether the row conflicts and should instead
-- take the UPDATE path. The original fn_apply_stock_movement (migration 0012)
-- inserted the movement's raw, possibly-negative quantity_kg directly:
--
--   INSERT INTO stock_balance (..., quantity_kg, ...) VALUES (..., NEW.quantity_kg, ...)
--   ON CONFLICT (lot_id, location_id) DO UPDATE SET quantity_kg = b.quantity_kg + EXCLUDED.quantity_kg
--
-- For any debiting movement (ISSUE_TO_JOB, TRANSFER_OUT, ADJUSTMENT_OUT,
-- DISPATCH_OUT — anything with quantity_kg < 0), the speculative row itself
-- fails ck_stock_balance__non_negative and the statement errors out, EVEN WHEN
-- the resulting balance (existing + delta) would be non-negative and perfectly
-- valid. In other words: every single withdrawal against existing stock failed
-- unconditionally, regardless of how much stock was on hand. Only ever-first
-- movements at a location (no prior balance row) or purely additive movements
-- worked.
--
-- Fix: seed the row (if absent) with a neutral 0 balance via a NO-OP conflict
-- target, then apply the real delta with a plain UPDATE. A plain UPDATE
-- evaluates the CHECK against the actual post-arithmetic row, which is what
-- ck_stock_balance__non_negative is meant to guard.
CREATE OR REPLACE FUNCTION public.fn_apply_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.stock_balance (
    lot_id, location_id, customer_id, consignment_id, bag_type_id,
    quantity_kg, kesha_count, last_movement_id, updated_at
  ) VALUES (
    NEW.lot_id, NEW.location_id, NEW.customer_id, NEW.consignment_id, NEW.bag_type_id,
    0, 0, NEW.id, now()
  )
  ON CONFLICT (lot_id, location_id) DO NOTHING;

  UPDATE public.stock_balance SET
    quantity_kg      = quantity_kg + NEW.quantity_kg,
    kesha_count      = kesha_count + NEW.kesha_count,
    bag_type_id      = COALESCE(NEW.bag_type_id, bag_type_id),
    last_movement_id = NEW.id,
    updated_at       = now()
  WHERE lot_id = NEW.lot_id AND location_id = NEW.location_id;

  RETURN NEW;
END;
$$;

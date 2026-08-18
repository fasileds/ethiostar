-- 20260812094500_0005_create_warehouse_tables.sql
-- phase:      1
-- module:     M12 Warehouse, Room & Section Management
-- ticket:     CPMS-005
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- warehouse → store_room → store_section
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.warehouse (
  id           uuid PRIMARY KEY,
  branch_id    uuid NOT NULL REFERENCES public.branch(id),
  code         text NOT NULL,
  name_en      text NOT NULL,
  name_am      text,
  description  text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_warehouse__code   ON public.warehouse (code);
CREATE        INDEX idx_warehouse__branch ON public.warehouse (branch_id);

CREATE TABLE public.store_room (
  id           uuid PRIMARY KEY,
  warehouse_id uuid NOT NULL REFERENCES public.warehouse(id),
  code         text NOT NULL,
  name_en      text NOT NULL,
  name_am      text,
  description  text,
  length_m     numeric(6,3),
  width_m      numeric(6,3),
  height_m     numeric(6,3),
  is_active    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_store_room__code      ON public.store_room (code);
CREATE        INDEX idx_store_room__warehouse ON public.store_room (warehouse_id);

-- The lowest level, and the only one stock is actually placed into.
CREATE TABLE public.store_section (
  id              uuid PRIMARY KEY,
  room_id         uuid NOT NULL REFERENCES public.store_room(id),
  code            text NOT NULL,
  name_en         text NOT NULL,
  name_am         text,
  capacity_kg     numeric(14,3) NOT NULL,
  capacity_kesha  integer NOT NULL,
  safe_fill_pct   numeric(6,3) NOT NULL DEFAULT 0.900,
  -- A virtual section per warehouse that receives PROCESS_LOSS movements. Loss is a
  -- DESTINATION in the ledger, not a second withdrawal; routing it to a real location keeps
  -- "every kilogram is at a defined location" true even for the kilograms that became dust.
  is_loss_account boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,

  CONSTRAINT ck_store_section__capacity_kg    CHECK (capacity_kg >= 0),
  CONSTRAINT ck_store_section__capacity_kesha CHECK (capacity_kesha >= 0),
  CONSTRAINT ck_store_section__safe_fill      CHECK (safe_fill_pct > 0 AND safe_fill_pct <= 1)
);
CREATE UNIQUE INDEX uq_store_section__code ON public.store_section (code);
CREATE        INDEX idx_store_section__room ON public.store_section (room_id);
-- At most one loss account per room; the seed creates one per warehouse.
CREATE UNIQUE INDEX uq_store_section__loss_account ON public.store_section (room_id)
  WHERE is_loss_account = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- capacity_reservation — what makes the pre-arrival check honest
-- ═══════════════════════════════════════════════════════════════════════════
-- Without reservations, ten delivery requests approved on Monday all "fit" and none of them
-- do on Friday. Created on approval, consumed on placement, expired by a worker job.
CREATE TABLE public.capacity_reservation (
  id                  uuid PRIMARY KEY,
  location_id         uuid NOT NULL REFERENCES public.store_section(id),
  -- FK to delivery_request is added by migration 0013 (Step 17); declaring it here would be
  -- a forward reference to a table that does not exist yet.
  delivery_request_id uuid NOT NULL,
  customer_id         uuid NOT NULL,
  quantity_kg         numeric(14,3) NOT NULL,
  kesha_count         integer NOT NULL,
  status              text NOT NULL DEFAULT 'ACTIVE',
  expires_at          timestamptz NOT NULL,
  consumed_at         timestamptz,
  released_at         timestamptz,
  released_reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,

  CONSTRAINT ck_capacity_reservation__status
    CHECK (status IN ('ACTIVE','CONSUMED','EXPIRED','RELEASED')),
  CONSTRAINT ck_capacity_reservation__quantity CHECK (quantity_kg > 0),
  CONSTRAINT ck_capacity_reservation__kesha    CHECK (kesha_count > 0)
);

-- Partial indexes: the ACTIVE set stays small forever while the table grows without bound,
-- so the capacity query — which runs on every availability check — stays cheap.
CREATE INDEX idx_capacity_reservation__active   ON public.capacity_reservation (location_id)
  WHERE status = 'ACTIVE';
CREATE INDEX idx_capacity_reservation__expiring ON public.capacity_reservation (expires_at)
  WHERE status = 'ACTIVE';
CREATE INDEX idx_capacity_reservation__request  ON public.capacity_reservation (delivery_request_id);

COMMENT ON TABLE public.capacity_reservation IS
  'M12: reservations are what make the M11 pre-arrival capacity check honest rather than '
  'optimistic. Check-and-reserve runs under pg_advisory_xact_lock on the room — a naive '
  '"SELECT available; if ok INSERT" is a race.';

CREATE TABLE public.location_alert_threshold (
  id              uuid PRIMARY KEY,
  location_id     uuid NOT NULL REFERENCES public.store_section(id) ON DELETE CASCADE,
  threshold_pct   numeric(6,3) NOT NULL,
  severity        text NOT NULL DEFAULT 'WARNING',
  notify_role_code text,
  last_fired_at   timestamptz,
  cooldown_hours  integer NOT NULL DEFAULT 24,
  is_active       boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,

  CONSTRAINT ck_location_alert_threshold__severity CHECK (severity IN ('WARNING','CRITICAL')),
  CONSTRAINT ck_location_alert_threshold__pct
    CHECK (threshold_pct > 0 AND threshold_pct <= 100)
);
CREATE UNIQUE INDEX uq_location_alert_threshold__pair
  ON public.location_alert_threshold (location_id, threshold_pct);

-- ═══════════════════════════════════════════════════════════════════════════
-- Occupancy view
-- ═══════════════════════════════════════════════════════════════════════════
-- A plain view, not materialized: occupancy must be LIVE. A stale occupancy figure means
-- coffee accepted against space that does not exist, which is exactly the M11 control.
-- stock_balance arrives in migration 0012 (Step 16); until then the view reports zero
-- occupancy, which is correct for an empty system.
CREATE OR REPLACE VIEW public.vw_section_capacity AS
SELECT
  s.id                AS location_id,
  s.code              AS section_code,
  r.id                AS room_id,
  r.code              AS room_code,
  w.id                AS warehouse_id,
  w.code              AS warehouse_code,
  s.capacity_kg,
  s.capacity_kesha,
  s.safe_fill_pct,
  s.is_loss_account,
  COALESCE(res.reserved_kg, 0)::numeric(14,3)  AS reserved_kg,
  COALESCE(res.reserved_kesha, 0)::integer     AS reserved_kesha
FROM public.store_section s
JOIN public.store_room r ON r.id = s.room_id
JOIN public.warehouse  w ON w.id = r.warehouse_id
LEFT JOIN LATERAL (
  SELECT SUM(cr.quantity_kg) AS reserved_kg,
         SUM(cr.kesha_count) AS reserved_kesha
  FROM public.capacity_reservation cr
  WHERE cr.location_id = s.id
    AND cr.status = 'ACTIVE'
    AND cr.expires_at > now()
) res ON true
WHERE s.is_active;

COMMENT ON VIEW public.vw_section_capacity IS
  'Live section capacity with active reservations. Deliberately NOT materialized: a stale '
  'occupancy figure means coffee accepted against space that does not exist.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'warehouse','store_room','store_section','capacity_reservation','location_alert_threshold'
  ] LOOP
    PERFORM public.fn_attach_standard_triggers(t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

GRANT SELECT ON public.vw_section_capacity TO authenticated;

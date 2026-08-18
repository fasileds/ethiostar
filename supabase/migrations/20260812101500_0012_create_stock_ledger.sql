-- 20260812101500_0012_create_stock_ledger.sql
-- phase:      1
-- module:     stock ledger (the source of truth for every quantity)
-- ticket:     CPMS-012
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- THE MOST IMPORTANT MIGRATION IN THE SYSTEM.
-- stock_movement is APPEND-ONLY and is the source of truth. stock_balance is a projection
-- maintained in the same transaction and can be dropped and rebuilt from the ledger. The
-- reverse is impossible, and that asymmetry is the whole argument for this design.
-- docs/adr/0003-consignment-spine-and-stock-ledger.md

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- stock_movement — PARTITIONED, append-only
-- ═══════════════════════════════════════════════════════════════════════════
-- Partitioned by month from day one. Partitioning an EMPTY table is free; partitioning a
-- table with 50 million rows is an outage.
CREATE TABLE public.stock_movement (
  id             uuid NOT NULL,

  -- When it physically happened.
  occurred_at    timestamptz NOT NULL,
  -- When the system was told. Coffee arrives at 17:40 and is entered at 09:10 the next
  -- morning; with one timestamp, dwell time and daily throughput are both quietly wrong.
  recorded_at    timestamptz NOT NULL DEFAULT now(),

  movement_type  text NOT NULL,

  lot_id         uuid NOT NULL REFERENCES public.lot(id),
  -- Denormalised deliberately: every ledger query filters by customer.
  customer_id    uuid NOT NULL,
  consignment_id uuid NOT NULL REFERENCES public.consignment(id),
  -- NOT NULL is the M12 key control as a schema constraint rather than a habit:
  -- "Every kilogram in the system must be at a defined location."
  location_id    uuid NOT NULL REFERENCES public.store_section(id),

  -- SIGNED: + increases, − decreases.
  quantity_kg    numeric(14,3) NOT NULL,
  kesha_count    integer NOT NULL,

  bag_type_id    uuid REFERENCES public.bag_type(id),
  reason_code_id uuid REFERENCES public.reason_code(id),

  source_type    text NOT NULL,
  source_id      uuid NOT NULL,

  actor_id       uuid NOT NULL,
  witness_id     uuid,
  narrative      text,

  -- Groups every movement of one business operation. A job's rows sum to zero.
  correlation_id uuid NOT NULL,

  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,

  PRIMARY KEY (id, occurred_at),

  CONSTRAINT ck_stock_movement__type CHECK (movement_type IN (
    'RECEIPT','PLACEMENT','TRANSFER_OUT','TRANSFER_IN','ISSUE_TO_JOB','OUTPUT_FROM_JOB',
    'PROCESS_LOSS','ADJUSTMENT_IN','ADJUSTMENT_OUT','DISPATCH_OUT','COUNT_VARIANCE'
  )),
  CONSTRAINT ck_stock_movement__non_zero CHECK (quantity_kg <> 0 OR kesha_count <> 0),
  -- Belt and braces with the domain check: a data-fix script does not run the domain.
  CONSTRAINT ck_stock_movement__reason_required CHECK (
    movement_type NOT IN ('ADJUSTMENT_IN','ADJUSTMENT_OUT','COUNT_VARIANCE','PROCESS_LOSS')
    OR reason_code_id IS NOT NULL
  ),
  -- Sign discipline, enforced by the database as well as the domain.
  -- NOTE PROCESS_LOSS IS POSITIVE: loss is a DESTINATION, not a second withdrawal.
  -- Negative loss double-counts against the issue and makes every job appear short by
  -- exactly the loss.
  CONSTRAINT ck_stock_movement__sign CHECK (
    (movement_type IN ('RECEIPT','PLACEMENT','TRANSFER_IN','OUTPUT_FROM_JOB','PROCESS_LOSS',
                       'ADJUSTMENT_IN','COUNT_VARIANCE') AND quantity_kg >= 0)
    OR
    (movement_type IN ('TRANSFER_OUT','ISSUE_TO_JOB','ADJUSTMENT_OUT','DISPATCH_OUT')
     AND quantity_kg <= 0)
  )
) PARTITION BY RANGE (occurred_at);

-- Initial partitions. A scheduled job creates future months; `stock_movement_default`
-- catches anything outside the declared range so an insert can never fail for want of a
-- partition — losing a movement is worse than an untidy partition.
CREATE TABLE public.stock_movement_2026_08 PARTITION OF public.stock_movement
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE public.stock_movement_2026_09 PARTITION OF public.stock_movement
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE public.stock_movement_2026_10 PARTITION OF public.stock_movement
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE public.stock_movement_2026_11 PARTITION OF public.stock_movement
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE public.stock_movement_2026_12 PARTITION OF public.stock_movement
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE public.stock_movement_default PARTITION OF public.stock_movement DEFAULT;

CREATE INDEX idx_stock_movement__lot_occurred ON public.stock_movement (lot_id, occurred_at DESC);
CREATE INDEX idx_stock_movement__source       ON public.stock_movement (source_type, source_id);
CREATE INDEX idx_stock_movement__correlation  ON public.stock_movement (correlation_id);
CREATE INDEX idx_stock_movement__customer     ON public.stock_movement (customer_id, occurred_at DESC);
CREATE INDEX idx_stock_movement__location     ON public.stock_movement (location_id, occurred_at DESC);

COMMENT ON TABLE public.stock_movement IS
  'THE SOURCE OF TRUTH for every quantity. Append-only. A mutable quantity_on_hand column '
  'is forbidden: in a custody dispute, "the column said 412 bags" is not an answer.';

-- ═══════════════════════════════════════════════════════════════════════════
-- stock_balance — the projection
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.stock_balance (
  lot_id           uuid NOT NULL REFERENCES public.lot(id),
  location_id      uuid NOT NULL REFERENCES public.store_section(id),
  customer_id      uuid NOT NULL,
  consignment_id   uuid NOT NULL REFERENCES public.consignment(id),
  bag_type_id      uuid REFERENCES public.bag_type(id),
  quantity_kg      numeric(14,3) NOT NULL DEFAULT 0,
  kesha_count      integer NOT NULL DEFAULT 0,
  last_movement_id uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (lot_id, location_id),

  -- You cannot hold negative coffee. Checked in the domain AND here, because a data-fix
  -- script does not run the domain.
  CONSTRAINT ck_stock_balance__non_negative CHECK (quantity_kg >= 0 AND kesha_count >= 0)
);

-- Partial indexes: empty rows do not bloat the hot path (the portal stock view).
CREATE INDEX idx_stock_balance__customer_lot ON public.stock_balance (customer_id, lot_id)
  WHERE quantity_kg > 0;
CREATE INDEX idx_stock_balance__location     ON public.stock_balance (location_id)
  WHERE quantity_kg > 0;
CREATE INDEX idx_stock_balance__consignment  ON public.stock_balance (consignment_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- The projection maintainer
-- ═══════════════════════════════════════════════════════════════════════════
-- Runs in the SAME transaction as the movement insert. The ON CONFLICT DO UPDATE takes a
-- row lock and therefore serialises concurrent movements on one (lot, location) correctly —
-- which is why two store keepers moving the same lot cannot lose an update.
--
-- The non-negative CHECK fires here if a movement would overdraw the balance, so an
-- attempt to remove coffee that is not there fails the transaction rather than producing a
-- negative figure somebody later has to explain.
CREATE OR REPLACE FUNCTION public.fn_apply_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.stock_balance AS b (
    lot_id, location_id, customer_id, consignment_id, bag_type_id,
    quantity_kg, kesha_count, last_movement_id, updated_at
  ) VALUES (
    NEW.lot_id, NEW.location_id, NEW.customer_id, NEW.consignment_id, NEW.bag_type_id,
    NEW.quantity_kg, NEW.kesha_count, NEW.id, now()
  )
  ON CONFLICT (lot_id, location_id) DO UPDATE SET
    quantity_kg      = b.quantity_kg + EXCLUDED.quantity_kg,
    kesha_count      = b.kesha_count + EXCLUDED.kesha_count,
    bag_type_id      = COALESCE(EXCLUDED.bag_type_id, b.bag_type_id),
    last_movement_id = EXCLUDED.last_movement_id,
    updated_at       = now();

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stock_movement__apply_balance
  AFTER INSERT ON public.stock_movement
  FOR EACH ROW EXECUTE FUNCTION public.fn_apply_stock_movement();

-- ═══════════════════════════════════════════════════════════════════════════
-- Reconciliation — proves the projection still equals the ledger
-- ═══════════════════════════════════════════════════════════════════════════
-- Run nightly by the worker. Any row returned is drift, which is a paging alert: the
-- projection can be rebuilt from the ledger, but silent drift means someone has been
-- reading a wrong figure.
CREATE OR REPLACE FUNCTION public.fn_reconcile_stock_balance()
RETURNS TABLE (
  lot_id          uuid,
  location_id     uuid,
  projected_kg    numeric,
  ledger_kg       numeric,
  projected_kesha integer,
  ledger_kesha    integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    COALESCE(b.lot_id, m.lot_id),
    COALESCE(b.location_id, m.location_id),
    COALESCE(b.quantity_kg, 0),
    COALESCE(m.ledger_kg, 0),
    COALESCE(b.kesha_count, 0),
    COALESCE(m.ledger_kesha, 0)
  FROM public.stock_balance b
  FULL OUTER JOIN (
    SELECT lot_id, location_id,
           SUM(quantity_kg)::numeric AS ledger_kg,
           SUM(kesha_count)::integer AS ledger_kesha
    FROM public.stock_movement
    GROUP BY lot_id, location_id
  ) m ON m.lot_id = b.lot_id AND m.location_id = b.location_id
  WHERE COALESCE(b.quantity_kg, 0) <> COALESCE(m.ledger_kg, 0)
     OR COALESCE(b.kesha_count, 0) <> COALESCE(m.ledger_kesha, 0);
$$;

COMMENT ON FUNCTION public.fn_reconcile_stock_balance() IS
  'Returns one row per (lot, location) where the projection disagrees with the ledger. '
  'Any result is a paging alert. Recovery is to REBUILD the projection — never to edit '
  'the ledger.';

-- Rebuild the projection from the ledger. This direction is possible; the reverse is not,
-- and that asymmetry is the argument for the whole design.
CREATE OR REPLACE FUNCTION public.fn_rebuild_stock_balance()
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_rows bigint;
BEGIN
  DELETE FROM public.stock_balance;

  INSERT INTO public.stock_balance (
    lot_id, location_id, customer_id, consignment_id, bag_type_id,
    quantity_kg, kesha_count, last_movement_id, updated_at
  )
  SELECT
    m.lot_id,
    m.location_id,
    MIN(m.customer_id),
    MIN(m.consignment_id),
    MIN(m.bag_type_id),
    SUM(m.quantity_kg),
    SUM(m.kesha_count),
    NULL,
    now()
  FROM public.stock_movement m
  GROUP BY m.lot_id, m.location_id;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Supporting operational tables
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.stock_transfer (
  id               uuid PRIMARY KEY,
  reference        text NOT NULL,
  from_location_id uuid NOT NULL REFERENCES public.store_section(id),
  to_location_id   uuid NOT NULL REFERENCES public.store_section(id),
  occurred_at      timestamptz NOT NULL,
  reason_code_id   uuid REFERENCES public.reason_code(id),
  narrative        text,
  correlation_id   uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,
  CONSTRAINT ck_stock_transfer__distinct CHECK (from_location_id <> to_location_id)
);
CREATE UNIQUE INDEX uq_stock_transfer__reference ON public.stock_transfer (reference);
CREATE INDEX idx_stock_transfer__from ON public.stock_transfer (from_location_id, occurred_at DESC);
CREATE INDEX idx_stock_transfer__to   ON public.stock_transfer (to_location_id, occurred_at DESC);

-- The highest-risk operation in the system (threat T2). Distinct permission, mandatory
-- reason code, and it appears on the exception register.
CREATE TABLE public.stock_adjustment (
  id                uuid PRIMARY KEY,
  reference         text NOT NULL,
  lot_id            uuid NOT NULL REFERENCES public.lot(id),
  location_id       uuid NOT NULL REFERENCES public.store_section(id),
  quantity_kg_delta numeric(14,3) NOT NULL,
  kesha_count_delta integer NOT NULL,
  reason_code_id    uuid NOT NULL REFERENCES public.reason_code(id),
  narrative         text,
  occurred_at       timestamptz NOT NULL,
  approved_by       uuid,
  approved_at       timestamptz,
  correlation_id    uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_stock_adjustment__reference ON public.stock_adjustment (reference);
CREATE INDEX idx_stock_adjustment__lot      ON public.stock_adjustment (lot_id, occurred_at DESC);
CREATE INDEX idx_stock_adjustment__occurred ON public.stock_adjustment (occurred_at DESC);

CREATE TABLE public.stock_count (
  id          uuid PRIMARY KEY,
  reference   text NOT NULL,
  location_id uuid NOT NULL REFERENCES public.store_section(id),
  counted_on  date NOT NULL,
  status      text NOT NULL DEFAULT 'DRAFT',
  counted_by  uuid NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,
  CONSTRAINT ck_stock_count__status CHECK (status IN ('DRAFT','COUNTED','APPROVED','CANCELLED'))
);
CREATE UNIQUE INDEX uq_stock_count__reference ON public.stock_count (reference);
CREATE INDEX idx_stock_count__location ON public.stock_count (location_id, counted_on DESC);

CREATE TABLE public.stock_count_line (
  id                   uuid PRIMARY KEY,
  count_id             uuid NOT NULL REFERENCES public.stock_count(id) ON DELETE CASCADE,
  lot_id               uuid NOT NULL REFERENCES public.lot(id),
  -- Snapshot of the projection at count time: what the system believed.
  expected_quantity_kg numeric(14,3) NOT NULL,
  expected_kesha_count integer NOT NULL,
  -- What was physically found.
  counted_quantity_kg  numeric(14,3) NOT NULL,
  counted_kesha_count  integer NOT NULL,
  reason_code_id       uuid REFERENCES public.reason_code(id),
  narrative            text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_stock_count_line__count ON public.stock_count_line (count_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Reporting views
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.vw_stock_on_hand AS
SELECT
  b.customer_id,
  b.consignment_id,
  c.reference        AS consignment_reference,
  b.lot_id,
  l.reference        AS lot_reference,
  l.status           AS lot_status,
  l.coffee_type_id,
  l.coffee_grade_id,
  l.output_classification_id,
  b.location_id,
  s.code             AS section_code,
  r.code             AS room_code,
  w.code             AS warehouse_code,
  b.quantity_kg,
  b.kesha_count,
  l.storage_start_date,
  -- Dwell time in the plant's timezone, not UTC.
  GREATEST(0, (CURRENT_DATE - l.storage_start_date))::integer AS dwell_days
FROM public.stock_balance b
JOIN public.lot          l ON l.id = b.lot_id
JOIN public.consignment  c ON c.id = b.consignment_id
JOIN public.store_section s ON s.id = b.location_id
JOIN public.store_room    r ON r.id = s.room_id
JOIN public.warehouse     w ON w.id = r.warehouse_id
WHERE b.quantity_kg > 0;

COMMENT ON VIEW public.vw_stock_on_hand IS
  'Live stock by customer, consignment, lot and location, in kg AND kesha — the M09 '
  'customer stock statement and the M12 occupancy figures both read this.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Append-only enforcement, triggers, grants
-- ═══════════════════════════════════════════════════════════════════════════
-- The ledger is the evidential record. UPDATE and DELETE are blocked for every role
-- INCLUDING service_role, because service_role bypasses RLS but not triggers or grants.
CREATE TRIGGER trg_stock_movement__append_only
  BEFORE UPDATE OR DELETE ON public.stock_movement
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON public.stock_movement
  FROM authenticated, anon, service_role;

SELECT public.fn_attach_standard_triggers('stock_transfer');
SELECT public.fn_attach_standard_triggers('stock_adjustment');
SELECT public.fn_attach_standard_triggers('stock_count');
SELECT public.fn_attach_standard_triggers('stock_count_line');

GRANT SELECT, INSERT ON public.stock_movement TO authenticated;
GRANT SELECT ON public.stock_balance TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.stock_transfer, public.stock_adjustment,
                                public.stock_count, public.stock_count_line TO authenticated;
GRANT SELECT ON public.vw_stock_on_hand TO authenticated;

-- stock_balance is written ONLY by the trigger above. No direct grant: a projection that
-- can be hand-edited is not a projection.

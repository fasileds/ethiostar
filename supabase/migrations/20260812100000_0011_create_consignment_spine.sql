-- 20260812100000_0011_create_consignment_spine.sql
-- phase:      1
-- module:     consignment spine (shared by M11–M17)
-- ticket:     CPMS-011
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- consignment
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.consignment (
  id                    uuid PRIMARY KEY,
  reference             text NOT NULL,
  branch_id             uuid NOT NULL REFERENCES public.branch(id),
  customer_id           uuid NOT NULL,
  -- FK to delivery_request added by migration 0013 (forward reference avoided).
  delivery_request_id   uuid,
  status                text NOT NULL DEFAULT 'REQUESTED',

  coffee_type_id        uuid REFERENCES public.coffee_type(id),
  origin_region_id      uuid REFERENCES public.region(id),
  origin_woreda_id      uuid REFERENCES public.woreda(id),
  harvest_year_id       uuid REFERENCES public.harvest_year(id),

  declared_quantity_kg  numeric(14,3),
  declared_kesha_count  integer,
  received_quantity_kg  numeric(14,3),
  received_kesha_count  integer,

  expected_arrival_on   date,
  received_at           timestamptz,
  -- Set at CONFIRMED RECEIPT. Consumed by ageing reports now and by M20 storage charging
  -- in Phase 2. Recorded here because it CANNOT be backfilled: created_at is the day the
  -- record was typed, not the day the coffee arrived.
  storage_start_date    date,
  closed_at             timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,

  CONSTRAINT ck_consignment__status CHECK (status IN (
    'REQUESTED','ACCEPTED','RECEIVED','STORED','SCHEDULED','IN_PROCESS','PROCESSED',
    'ACCEPTED_BY_CUSTOMER','RELEASE_REQUESTED','DISPATCHED','CLOSED','CANCELLED'
  ))
);

CREATE UNIQUE INDEX uq_consignment__reference        ON public.consignment (reference);
CREATE        INDEX idx_consignment__customer        ON public.consignment (customer_id, created_at DESC);
CREATE        INDEX idx_consignment__status_customer ON public.consignment (status, customer_id, created_at DESC);
CREATE        INDEX idx_consignment__storage_start   ON public.consignment (storage_start_date);

-- ═══════════════════════════════════════════════════════════════════════════
-- The transition table, AS DATA — enforcement layer 3
-- ═══════════════════════════════════════════════════════════════════════════
-- Layers 1 and 2 are the domain state machine and the repository. This layer catches
-- migrations, data-fix scripts and manual DBA intervention, which is exactly when the
-- application-level discipline breaks.
CREATE TABLE public.consignment_transition (
  from_status text NOT NULL,
  to_status   text NOT NULL,
  description text,
  PRIMARY KEY (from_status, to_status)
);

INSERT INTO public.consignment_transition (from_status, to_status, description) VALUES
  ('REQUESTED',           'ACCEPTED',             'Delivery request approved; capacity reserved'),
  ('REQUESTED',           'CANCELLED',            'Request withdrawn or rejected'),
  ('ACCEPTED',            'RECEIVED',             'Goods receipt confirmed at the gate'),
  ('ACCEPTED',            'CANCELLED',            'Approved request cancelled before arrival'),
  ('RECEIVED',            'STORED',               'Every lot placed in a room and section'),
  ('STORED',              'SCHEDULED',            'Processing appointment allocated'),
  ('STORED',              'RELEASE_REQUESTED',    'Customer withdraws unprocessed coffee'),
  ('SCHEDULED',           'IN_PROCESS',           'Operator accepted and started the job'),
  ('SCHEDULED',           'STORED',               'Appointment cancelled'),
  ('IN_PROCESS',          'PROCESSED',            'Outputs recorded; mass balance within tolerance'),
  ('PROCESSED',           'ACCEPTED_BY_CUSTOMER', 'Mirt Merekebiya signed'),
  ('ACCEPTED_BY_CUSTOMER','RELEASE_REQUESTED',    'Customer requested release'),
  ('RELEASE_REQUESTED',   'DISPATCHED',           'Gate pass used; stock deducted at departure'),
  ('RELEASE_REQUESTED',   'ACCEPTED_BY_CUSTOMER', 'Release request cancelled'),
  ('DISPATCHED',          'CLOSED',               'Consignment closed');

COMMENT ON TABLE public.consignment_transition IS
  'The legal lifecycle transitions. MUST stay in sync with CONSIGNMENT_TRANSITIONS in '
  'src/modules/consignment/domain/consignment.state-machine.ts — an integration test '
  'asserts the two agree.';

-- Append-only history: "every transition is logged with the user and timestamp".
CREATE TABLE public.consignment_status_history (
  id             uuid PRIMARY KEY,
  consignment_id uuid NOT NULL REFERENCES public.consignment(id),
  from_status    text,
  to_status      text NOT NULL,
  occurred_at    timestamptz NOT NULL,
  actor_id       uuid NOT NULL,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid
);
CREATE INDEX idx_consignment_status_history__consignment
  ON public.consignment_status_history (consignment_id, occurred_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- The transition guard trigger
-- ═══════════════════════════════════════════════════════════════════════════
-- Rejects any status change whose (old, new) pair is absent from the table above, AND
-- refuses a change that does not come with a history row. The second half is what makes
-- "every transition is logged" structurally true rather than a convention.
CREATE OR REPLACE FUNCTION public.fn_guard_consignment_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.consignment_transition t
    WHERE t.from_status = OLD.status AND t.to_status = NEW.status
  ) THEN
    RAISE EXCEPTION
      'Illegal consignment transition % -> % (consignment %)', OLD.status, NEW.status, NEW.id
      USING ERRCODE = 'restrict_violation',
            HINT = 'The lifecycle does not permit a state to be skipped.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_consignment__guard_transition
  BEFORE UPDATE OF status ON public.consignment
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_consignment_transition();

-- ═══════════════════════════════════════════════════════════════════════════
-- lot
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.lot (
  id                        uuid PRIMARY KEY,
  reference                 text NOT NULL,
  consignment_id            uuid NOT NULL REFERENCES public.consignment(id),
  customer_id               uuid NOT NULL,
  status                    text NOT NULL DEFAULT 'IN_STORE',

  coffee_type_id            uuid REFERENCES public.coffee_type(id),
  coffee_grade_id           uuid REFERENCES public.coffee_grade(id),
  bag_type_id               uuid REFERENCES public.bag_type(id),
  -- Null for received lots; set for the four processing outputs.
  output_classification_id  uuid REFERENCES public.output_classification(id),

  -- ORIGINAL quantity. The CURRENT balance comes from the ledger, never from here.
  initial_quantity_kg       numeric(14,3) NOT NULL,
  initial_kesha_count       integer NOT NULL,

  storage_start_date        date,

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,

  CONSTRAINT ck_lot__status CHECK (status IN (
    'IN_STORE','RESERVED_FOR_JOB','CONSUMED','PRODUCED','ACCEPTED','DISPATCHED'
  )),
  CONSTRAINT ck_lot__initial_positive CHECK (initial_quantity_kg > 0)
);

CREATE UNIQUE INDEX uq_lot__reference             ON public.lot (reference);
CREATE        INDEX idx_lot__consignment          ON public.lot (consignment_id);
CREATE        INDEX idx_lot__customer_status      ON public.lot (customer_id, status);
CREATE        INDEX idx_lot__output_classification ON public.lot (output_classification_id);

CREATE TABLE public.lot_status_history (
  id          uuid PRIMARY KEY,
  lot_id      uuid NOT NULL REFERENCES public.lot(id),
  from_status text,
  to_status   text NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor_id    uuid NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid
);
CREATE INDEX idx_lot_status_history__lot ON public.lot_status_history (lot_id, occurred_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- lot_lineage — edges, not a parent_lot_id column
-- ═══════════════════════════════════════════════════════════════════════════
-- Costs nothing now and supports blending and re-processing later without a migration.
-- The coffee passport is a recursive CTE over this table.
CREATE TABLE public.lot_lineage (
  parent_lot_id uuid NOT NULL REFERENCES public.lot(id),
  child_lot_id  uuid NOT NULL REFERENCES public.lot(id),
  -- FK to job_order added by migration 0016.
  job_order_id  uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_lot_id, child_lot_id),
  CONSTRAINT ck_lot_lineage__no_self CHECK (parent_lot_id <> child_lot_id)
);
CREATE INDEX idx_lot_lineage__child ON public.lot_lineage (child_lot_id);
CREATE INDEX idx_lot_lineage__job   ON public.lot_lineage (job_order_id);

-- Guard against a lineage CYCLE. A lot that is transitively its own ancestor would make
-- the coffee-passport recursive CTE loop forever.
CREATE OR REPLACE FUNCTION public.fn_guard_lot_lineage_cycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT parent_lot_id FROM public.lot_lineage WHERE child_lot_id = NEW.parent_lot_id
      UNION
      SELECT ll.parent_lot_id
      FROM public.lot_lineage ll
      JOIN ancestors a ON ll.child_lot_id = a.parent_lot_id
    )
    SELECT 1 FROM ancestors WHERE parent_lot_id = NEW.child_lot_id
  ) THEN
    RAISE EXCEPTION 'Lot lineage cycle: % is already an ancestor of %',
      NEW.child_lot_id, NEW.parent_lot_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lot_lineage__guard_cycle
  BEFORE INSERT ON public.lot_lineage
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_lot_lineage_cycle();

-- Current placement, for the "where is it?" question. Derived from the ledger.
CREATE TABLE public.lot_placement (
  lot_id      uuid NOT NULL REFERENCES public.lot(id),
  location_id uuid NOT NULL REFERENCES public.store_section(id),
  placed_at   timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (lot_id, location_id)
);
CREATE INDEX idx_lot_placement__location ON public.lot_placement (location_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═══════════════════════════════════════════════════════════════════════════
SELECT public.fn_attach_standard_triggers('consignment');
SELECT public.fn_attach_standard_triggers('lot');
SELECT public.fn_attach_standard_triggers('lot_placement');

-- History tables are evidence: append-only.
SELECT public.fn_attach_append_only('consignment_status_history');
SELECT public.fn_attach_append_only('lot_status_history');

CREATE TRIGGER trg_lot_lineage__audit
  AFTER INSERT OR DELETE ON public.lot_lineage
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_row();

GRANT SELECT, INSERT, UPDATE ON public.consignment, public.lot, public.lot_placement
  TO authenticated;
GRANT SELECT, INSERT ON public.consignment_status_history, public.lot_status_history,
                        public.lot_lineage TO authenticated;
GRANT SELECT ON public.consignment_transition TO authenticated;

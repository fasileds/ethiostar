-- 20260812093000_0004_create_master_data_tables.sql
-- phase:      1
-- module:     M02 Organisation & Master Data Management
-- ticket:     CPMS-004
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- Organisation and geography
-- ═══════════════════════════════════════════════════════════════════════════
-- `branch` exists from day one with a single seeded row, so a second EthioStar site never
-- requires a migration of the operational tables.
CREATE TABLE public.branch (
  id         uuid PRIMARY KEY,
  code       text NOT NULL,
  name_en    text NOT NULL,
  name_am    text,
  address    text,
  city       text,
  phone      text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_branch__code ON public.branch (code);

CREATE TABLE public.region (
  id         uuid PRIMARY KEY,
  code       text NOT NULL,
  name_en    text NOT NULL,
  name_am    text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_region__code ON public.region (code);

CREATE TABLE public.woreda (
  id         uuid PRIMARY KEY,
  region_id  uuid NOT NULL REFERENCES public.region(id),
  code       text NOT NULL,
  name_en    text NOT NULL,
  name_am    text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_woreda__code   ON public.woreda (code);
CREATE        INDEX idx_woreda__region ON public.woreda (region_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- Coffee master data
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.coffee_type (
  id                          uuid PRIMARY KEY,
  code                        text NOT NULL,
  name_en                     text NOT NULL,
  name_am                     text,
  description                 text,
  -- A natural sun-dried lot does not behave like a washed one. One tolerance across both
  -- produces either false exceptions or a tolerance too loose to catch anything.
  mass_balance_tolerance_pct  numeric(6,3),
  sort_order                  integer NOT NULL DEFAULT 0,
  is_active                   boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_coffee_type__code ON public.coffee_type (code);

CREATE TABLE public.coffee_grade (
  id         uuid PRIMARY KEY,
  code       text NOT NULL,
  name_en    text NOT NULL,
  name_am    text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_coffee_grade__code ON public.coffee_grade (code);

CREATE TABLE public.screen_size (
  id         uuid PRIMARY KEY,
  code       text NOT NULL,
  name_en    text NOT NULL,
  name_am    text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_screen_size__code ON public.screen_size (code);

CREATE TABLE public.certification (
  id           uuid PRIMARY KEY,
  code         text NOT NULL,
  name_en      text NOT NULL,
  name_am      text,
  issuing_body text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_certification__code ON public.certification (code);

CREATE TABLE public.harvest_year (
  id         uuid PRIMARY KEY,
  code       text NOT NULL,
  name_en    text NOT NULL,
  name_am    text,
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,
  is_current boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,

  CONSTRAINT ck_harvest_year__range CHECK (ends_on > starts_on)
);
CREATE UNIQUE INDEX uq_harvest_year__code ON public.harvest_year (code);
-- At most one current harvest year.
CREATE UNIQUE INDEX uq_harvest_year__single_current ON public.harvest_year (is_current)
  WHERE is_current = true;

-- ═══════════════════════════════════════════════════════════════════════════
-- Output classification — the M02 key control in its most literal form
-- ═══════════════════════════════════════════════════════════════════════════
-- "the four standard outputs ... defined as configurable records so additional
-- classifications can be added later without redevelopment."
CREATE TABLE public.output_classification (
  id                 uuid PRIMARY KEY,
  code               text NOT NULL,
  name_en            text NOT NULL,
  name_am            text,
  description        text,
  is_primary         boolean NOT NULL DEFAULT false,
  is_export_ready    boolean NOT NULL DEFAULT false,
  expected_yield_pct numeric(6,3),
  sort_order         integer NOT NULL DEFAULT 0,
  is_active          boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_output_classification__code ON public.output_classification (code);
-- Exactly one primary (export-ready) output. Rejected by the database, not by a hopeful
-- application check.
CREATE UNIQUE INDEX uq_output_classification__single_primary
  ON public.output_classification (is_primary) WHERE is_primary = true;

COMMENT ON TABLE public.output_classification IS
  'M15 output streams. A fifth classification is a row insert through the admin UI — no '
  'code change. Only is_primary carries special behaviour in application logic.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Bag types, with EFFECTIVE-DATED standard weights
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.bag_type (
  id            uuid PRIMARY KEY,
  code          text NOT NULL,
  name_en       text NOT NULL,
  name_am       text,
  material      text,
  ownership     text NOT NULL DEFAULT 'ETHIOSTAR',
  is_returnable boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,

  CONSTRAINT ck_bag_type__ownership CHECK (ownership IN ('ETHIOSTAR','CUSTOMER'))
);
CREATE UNIQUE INDEX uq_bag_type__code ON public.bag_type (code);

CREATE TABLE public.bag_type_version (
  id                     uuid PRIMARY KEY,
  bag_type_id            uuid NOT NULL REFERENCES public.bag_type(id),
  standard_net_weight_kg numeric(14,3) NOT NULL,
  tare_weight_kg         numeric(14,3),
  weight_tolerance_pct   numeric(6,3),
  effective_from         date NOT NULL,
  effective_to           date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,

  CONSTRAINT ck_bag_type_version__range
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT ck_bag_type_version__positive
    CHECK (standard_net_weight_kg > 0),

  -- THE CONSTRAINT THAT MATTERS.
  -- Overlapping effective dates are the classic source of "why was this priced at the old
  -- rate?", and application-level checks race. The database wins that race every time.
  -- Requires btree_gist (migration 0001).
  CONSTRAINT ex_bag_type_version__no_overlap EXCLUDE USING gist (
    bag_type_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  )
);
CREATE INDEX idx_bag_type_version__type
  ON public.bag_type_version (bag_type_id, effective_from DESC);

COMMENT ON CONSTRAINT ex_bag_type_version__no_overlap ON public.bag_type_version IS
  'M02 key control: no two versions of one bag type may overlap in time, so a receipt '
  'always resolves exactly one standard weight for its date.';

CREATE TABLE public.bag_weight_class (
  id            uuid PRIMARY KEY,
  code          text NOT NULL,
  name_en       text NOT NULL,
  name_am       text,
  min_weight_kg numeric(14,3) NOT NULL,
  max_weight_kg numeric(14,3),
  is_active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,

  CONSTRAINT ck_bag_weight_class__range
    CHECK (max_weight_kg IS NULL OR max_weight_kg > min_weight_kg)
);
CREATE UNIQUE INDEX uq_bag_weight_class__code ON public.bag_weight_class (code);

-- ═══════════════════════════════════════════════════════════════════════════
-- Customer classification and the configurable KYC checklist (M08)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.business_type (
  id          uuid PRIMARY KEY,
  code        text NOT NULL,
  name_en     text NOT NULL,
  name_am     text,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_business_type__code ON public.business_type (code);

CREATE TABLE public.kyc_document_type (
  id                  uuid PRIMARY KEY,
  code                text NOT NULL,
  name_en             text NOT NULL,
  name_am             text,
  description         text,
  has_expiry          boolean NOT NULL DEFAULT false,
  expiry_warning_days integer NOT NULL DEFAULT 30,
  sort_order          integer NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_kyc_document_type__code ON public.kyc_document_type (code);

CREATE TABLE public.kyc_document_requirement (
  id               uuid PRIMARY KEY,
  business_type_id uuid NOT NULL REFERENCES public.business_type(id)     ON DELETE CASCADE,
  document_type_id uuid NOT NULL REFERENCES public.kyc_document_type(id) ON DELETE RESTRICT,
  is_mandatory     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_kyc_document_requirement__pair
  ON public.kyc_document_requirement (business_type_id, document_type_id);
CREATE INDEX idx_kyc_document_requirement__business_type
  ON public.kyc_document_requirement (business_type_id);

COMMENT ON TABLE public.kyc_document_requirement IS
  'M08 key control reads this table: "An application cannot be approved while any mandatory '
  'document is unverified or expired." EthioStar changes the checklist without a release.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Reason codes
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.reason_code_category (
  id        uuid PRIMARY KEY,
  code      text NOT NULL,
  name_en   text NOT NULL,
  name_am   text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_reason_code_category__code ON public.reason_code_category (code);

CREATE TABLE public.reason_code (
  id                 uuid PRIMARY KEY,
  category_id        uuid NOT NULL REFERENCES public.reason_code_category(id),
  code               text NOT NULL,
  name_en            text NOT NULL,
  name_am            text,
  description        text,
  requires_narrative boolean NOT NULL DEFAULT false,
  is_exception       boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 0,
  is_active          boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_reason_code__code     ON public.reason_code (code);
CREATE        INDEX idx_reason_code__category ON public.reason_code (category_id, sort_order);

-- ═══════════════════════════════════════════════════════════════════════════
-- Labour, shifts, holidays, units
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE public.labour_activity_type (
  id                 uuid PRIMARY KEY,
  code               text NOT NULL,
  name_en            text NOT NULL,
  name_am            text,
  description        text,
  -- M18 key control expressed as data: names the operational event whose CONFIRMED count
  -- produces this activity. There is no path by which a labour quantity is typed by hand.
  derived_from_event text NOT NULL,
  sort_order         integer NOT NULL DEFAULT 0,
  is_active          boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_labour_activity_type__code ON public.labour_activity_type (code);

CREATE TABLE public.shift (
  id             uuid PRIMARY KEY,
  code           text NOT NULL,
  name_en        text NOT NULL,
  name_am        text,
  starts_at      text NOT NULL,
  ends_at        text NOT NULL,
  is_night_shift boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0,

  CONSTRAINT ck_shift__starts_at CHECK (starts_at ~ '^[0-2][0-9]:[0-5][0-9]$'),
  CONSTRAINT ck_shift__ends_at   CHECK (ends_at   ~ '^[0-2][0-9]:[0-5][0-9]$')
);
CREATE UNIQUE INDEX uq_shift__code ON public.shift (code);

CREATE TABLE public.holiday (
  id          uuid PRIMARY KEY,
  observed_on date NOT NULL,
  name_en     text NOT NULL,
  name_am     text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_holiday__date ON public.holiday (observed_on);

CREATE TABLE public.unit_of_measure (
  id             uuid PRIMARY KEY,
  code           text NOT NULL,
  name_en        text NOT NULL,
  name_am        text,
  symbol         text NOT NULL,
  decimal_places integer NOT NULL DEFAULT 3,
  is_base_unit   boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  version    integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX uq_unit_of_measure__code ON public.unit_of_measure (code);

-- ═══════════════════════════════════════════════════════════════════════════
-- Triggers and grants
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branch','region','woreda','coffee_type','coffee_grade','screen_size','certification',
    'harvest_year','output_classification','bag_type','bag_type_version','bag_weight_class',
    'business_type','kyc_document_type','kyc_document_requirement','reason_code_category',
    'reason_code','labour_activity_type','shift','holiday','unit_of_measure'
  ] LOOP
    PERFORM public.fn_attach_standard_triggers(t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT INSERT, UPDATE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- Master data is deactivated, never deleted: a code referenced by a historical transaction
-- must keep resolving. No DELETE grant is issued.

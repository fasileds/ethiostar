-- 20260812090500_0003_create_audit_and_event_tables.sql
-- phase:      1
-- module:     M07 Audit Trail, Compliance & Traceability
-- ticket:     CPMS-003
-- breaking:   no
-- lock-risk:  none   (new tables only)
-- rollback:   forward-fix only
--
-- MUST run immediately after 0001: fn_audit_row() inserts into public.audit_log, so every
-- table that attaches the standard triggers depends on this file existing first.

SET lock_timeout = '3s';
SET statement_timeout = '5min';

-- ═══════════════════════════════════════════════════════════════════════════
-- audit_log — generic row-level capture, PARTITIONED
-- ═══════════════════════════════════════════════════════════════════════════
-- M07 key control: "Audit records cannot be edited or deleted by any role."
--
-- Partitioned by month from day one. This table receives a row for every INSERT, UPDATE and
-- DELETE across the whole system, so it grows faster than anything else. Partitioning an
-- empty table is free; partitioning it at 50 million rows is an outage.
CREATE TABLE public.audit_log (
  id             uuid NOT NULL,
  entity_type    text NOT NULL,
  entity_id      uuid,
  operation      text NOT NULL,
  -- On UPDATE: { field: { from, to } } for the CHANGED fields only, so the diff is readable
  -- months later. "a weight correction shows exactly what it was and what it became."
  changed_fields jsonb,
  old_values     jsonb,
  new_values     jsonb,
  actor_id       uuid NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  request_id     text,
  ip_address     text,
  user_agent     text,

  PRIMARY KEY (id, occurred_at),
  CONSTRAINT ck_audit_log__operation CHECK (operation IN ('INSERT','UPDATE','DELETE'))
) PARTITION BY RANGE (occurred_at);

CREATE TABLE public.audit_log_2026_08 PARTITION OF public.audit_log
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE public.audit_log_2026_09 PARTITION OF public.audit_log
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE public.audit_log_2026_10 PARTITION OF public.audit_log
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE public.audit_log_2026_11 PARTITION OF public.audit_log
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE public.audit_log_2026_12 PARTITION OF public.audit_log
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
-- A DEFAULT partition so an audit write can never fail for want of one. Losing an audit row
-- is worse than an untidy partition.
CREATE TABLE public.audit_log_default PARTITION OF public.audit_log DEFAULT;

CREATE INDEX idx_audit_log__entity   ON public.audit_log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_log__actor    ON public.audit_log (actor_id, occurred_at DESC);
CREATE INDEX idx_audit_log__occurred ON public.audit_log (occurred_at DESC);

COMMENT ON TABLE public.audit_log IS
  'M07: every create, update and delete with before/after values, the actor, timestamp, IP '
  'and device. Append-only for EVERY role including service_role — the trigger fires '
  'regardless of role and the REVOKE covers service_role explicitly.';

-- ═══════════════════════════════════════════════════════════════════════════
-- domain_event — the semantic record, PARTITIONED
-- ═══════════════════════════════════════════════════════════════════════════
-- The substrate Phase 2 billing prices and Phase 3 forecasting learns from. History not
-- captured here does not exist later and cannot be reconstructed.
CREATE TABLE public.domain_event (
  id             uuid NOT NULL,
  name           text NOT NULL,
  -- Versioned from the FIRST event written. Retrofitting a version onto a production event
  -- store costs a migration and a compatibility shim; adding it now costs nothing.
  version        text NOT NULL DEFAULT '1',
  occurred_at    timestamptz NOT NULL,
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  aggregate_type text NOT NULL,
  aggregate_id   uuid NOT NULL,
  -- Null only for system actors (the worker).
  actor_id       uuid,
  -- Groups every event and movement of one business operation.
  correlation_id uuid NOT NULL,
  -- The event that caused this one, for tracing a chain of effects.
  causation_id   uuid,
  payload        jsonb NOT NULL,

  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE public.domain_event_2026_08 PARTITION OF public.domain_event
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE public.domain_event_2026_09 PARTITION OF public.domain_event
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE public.domain_event_2026_10 PARTITION OF public.domain_event
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE public.domain_event_2026_11 PARTITION OF public.domain_event
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE public.domain_event_2026_12 PARTITION OF public.domain_event
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE public.domain_event_default PARTITION OF public.domain_event DEFAULT;

CREATE INDEX idx_domain_event__aggregate   ON public.domain_event (aggregate_type, aggregate_id, occurred_at);
CREATE INDEX idx_domain_event__name        ON public.domain_event (name, occurred_at DESC);
CREATE INDEX idx_domain_event__correlation ON public.domain_event (correlation_id);
CREATE INDEX idx_domain_event__occurred    ON public.domain_event (occurred_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- outbox — the delivery queue
-- ═══════════════════════════════════════════════════════════════════════════
-- Written in the SAME transaction as the business change. If a crash happens between commit
-- and publish, the row is still here and the relay picks it up. Publishing after commit
-- without an outbox loses events — and a lost event is a customer who was never told their
-- appointment moved.
--
-- NOT partitioned: the unpublished set stays small forever, and the relay deletes nothing,
-- so growth is bounded by the retention job rather than by throughput.
CREATE TABLE public.outbox (
  id              uuid PRIMARY KEY,
  event_id        uuid NOT NULL,
  event_name      text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING',
  attempts        text NOT NULL DEFAULT '0',
  max_attempts    text NOT NULL DEFAULT '5',
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ck_outbox__status CHECK (status IN ('PENDING','CLAIMED','PUBLISHED','FAILED','DEAD'))
);

-- Partial index: the pending set stays small forever while the table grows without bound,
-- so the relay's claim query stays cheap.
CREATE INDEX idx_outbox__unpublished ON public.outbox (next_attempt_at)
  WHERE published_at IS NULL;
CREATE INDEX idx_outbox__event       ON public.outbox (event_id);
CREATE INDEX idx_outbox__dead        ON public.outbox (created_at DESC) WHERE status = 'DEAD';

-- No FK to domain_event: that table is partitioned by occurred_at, so a foreign key would
-- have to include the partition key. The relay reads the event by id and dead-letters if it
-- is missing, which is the safer failure mode anyway.

CREATE TABLE public.outbox_dead_letter (
  id            uuid PRIMARY KEY,
  outbox_id     uuid NOT NULL,
  event_id      uuid NOT NULL,
  event_name    text NOT NULL,
  attempts      integer NOT NULL,
  last_error    text,
  dead_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   uuid,
  resolution    text
);
CREATE INDEX idx_outbox_dead_letter__unresolved ON public.outbox_dead_letter (dead_at DESC)
  WHERE resolved_at IS NULL;

COMMENT ON TABLE public.outbox_dead_letter IS
  'Events whose side effects never happened. Each row is work the business EXPECTED — a '
  'notification that was never sent, a document never rendered. Requires human resolution, '
  'not silent deletion.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Append-only enforcement
-- ═══════════════════════════════════════════════════════════════════════════
-- Both mechanisms, deliberately. Under Supabase this matters MORE than elsewhere:
-- service_role bypasses RLS, so a policy alone would not stop a privileged path from
-- rewriting history. A BEFORE trigger fires regardless of role, and the REVOKE names
-- service_role explicitly.
CREATE TRIGGER trg_audit_log__append_only
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_mutation();

CREATE TRIGGER trg_domain_event__append_only
  BEFORE UPDATE OR DELETE ON public.domain_event
  FOR EACH ROW EXECUTE FUNCTION public.fn_block_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_log    FROM authenticated, anon, service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.domain_event FROM authenticated, anon, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants
-- ═══════════════════════════════════════════════════════════════════════════
-- Reads are gated by the `audit:view` permission in the application; RLS policies come in
-- migration 0021. INSERT on audit_log is granted because fn_audit_row runs SECURITY DEFINER
-- but the outbox relay and event store write as the calling role.
GRANT SELECT, INSERT ON public.audit_log, public.domain_event TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.outbox TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.outbox_dead_letter TO authenticated;

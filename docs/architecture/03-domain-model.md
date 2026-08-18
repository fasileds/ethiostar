# 3. Domain Model, Lifecycles and Invariants

The client document states the business rule that governs everything here: _"Every operational risk
in the business is a traceability risk."_ EthioStar holds an asset it does not own. The model below
is built so that any kilogram, any kesha and any decision can be explained months later.

---

## 3.1 Aggregates

An aggregate is a consistency boundary: everything inside it is updated in one transaction and its
invariants always hold.

| Aggregate             | Root                                         | Contains                                        | Key invariant                                                                     |
| --------------------- | -------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `Customer`            | `customer`                                   | contacts, documents, bank accounts, holds       | A customer with an expired mandatory document cannot raise new requests           |
| `CustomerApplication` | `customer_application`                       | applicant contacts, uploaded documents, reviews | Cannot be approved while any mandatory document is unverified or expired          |
| `Consignment`         | `consignment`                                | lots, status history                            | Status transitions follow the lifecycle; no state may be skipped                  |
| `DeliveryRequest`     | `delivery_request`                           | lines, approval decision, capacity reservation  | Cannot be approved without a satisfied capacity check                             |
| `GoodsReceipt`        | `goods_receipt`                              | lines, weighings, kesha confirmation            | Cannot exist without an approved delivery request                                 |
| `StorageLocation`     | `warehouse` → `store_room` → `store_section` | capacity                                        | Occupied + reserved never exceeds capacity                                        |
| `ProcessingRequest`   | `processing_request`                         | requested lots                                  | Only lots physically in store may be requested                                    |
| `Appointment`         | `appointment`                                | history, delay records                          | No two appointments overlap on one production line                                |
| `JobOrder`            | `job_order`                                  | inputs, outputs, losses                         | Cannot close while mass balance is out of tolerance and unexplained               |
| `Acceptance`          | `acceptance`                                 | lines, signature                                | Covers exactly the outputs of one completed job                                   |
| `ReleaseRequest`      | `release_request`                            | lines                                           | Only accepted lots may be requested for release                                   |
| `Dispatch`            | `dispatch`                                   | lines, gate pass, gate events                   | Stock is deducted at gate-out, not before                                         |
| `LabourActivity`      | `labour_activity`                            | earnings                                        | Quantity is always a reference to a confirmed operational count, never re-entered |
| `BagReconciliation`   | `bag_reconciliation`                         | lines                                           | in + issued = filled + returned + condemned, or a recorded explanation            |

**Cross-aggregate consistency uses domain events**, not nested writes. When a `GoodsReceipt` is
confirmed it emits `ConsignmentReceived`; the consignment lifecycle advances, labour activity is
created and the customer is notified — each in its own handler. Handlers that must be atomic with
the change (lifecycle, stock ledger) run inside the same transaction; handlers that must not block
it (email, PDF) run from the outbox.

---

## 3.2 The consignment lifecycle

The client document names the states and the rule: _"The system will not permit a state to be
skipped, and every transition is logged with the user and timestamp."_

```
                      ┌──────────────┐
                      │  REQUESTED   │  customer submitted delivery request (M09/M11)
                      └──────┬───────┘
                     approve │  reject/cancel ──────────► CANCELLED
                      ┌──────▼───────┐
                      │   ACCEPTED   │  request approved, capacity reserved (M11+M12)
                      └──────┬───────┘
                     receive │
                      ┌──────▼───────┐
                      │   RECEIVED   │  GRN confirmed: weights + kesha counted (M11)
                      └──────┬───────┘
                       place │
                      ┌──────▼───────┐
                      │    STORED    │  every lot has a room+section (M12)   ◄──┐
                      └──────┬───────┘                                          │ transfer
                    schedule │                                                  │ (no state change)
                      ┌──────▼───────┐                                          │
                      │  SCHEDULED   │  appointment allocated (M14)  ───────────┘
                      └──────┬───────┘         reschedule → stays SCHEDULED + delay record
                       start │
                      ┌──────▼───────┐
                      │  IN_PROCESS  │  operator accepted + started job (M15)
                      └──────┬───────┘
                    complete │  mass balance within tolerance / explained
                      ┌──────▼───────┐
                      │  PROCESSED   │  four outputs recorded and placed (M15)
                      └──────┬───────┘
                      accept │
                      ┌──────▼───────────┐
                      │ ACCEPTED_BY_CUST │  Mirt Merekebiya signed (M16) — ownership passes,
                      └──────┬───────────┘  coffee stays physically in store
                 request rel │
                      ┌──────▼───────────┐
                      │ RELEASE_REQUESTED│  (M17)
                      └──────┬───────────┘
                    dispatch │  clearance checks passed, gate pass issued, gate-out recorded
                      ┌──────▼───────┐
                      │  DISPATCHED  │  stock deducted at the moment of departure (M17)
                      └──────┬───────┘
                       close │
                      ┌──────▼───────┐
                      │    CLOSED    │  terminal
                      └──────────────┘
```

### Implementation

```ts
// src/modules/consignment/domain/consignment.state-machine.ts
export const CONSIGNMENT_TRANSITIONS = {
  REQUESTED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['STORED'],
  STORED: ['SCHEDULED', 'RELEASE_REQUESTED'], // release without processing is legal
  SCHEDULED: ['IN_PROCESS', 'STORED'], // appointment cancelled → back to store
  IN_PROCESS: ['PROCESSED'],
  PROCESSED: ['ACCEPTED_BY_CUSTOMER'],
  ACCEPTED_BY_CUSTOMER: ['RELEASE_REQUESTED'],
  RELEASE_REQUESTED: ['DISPATCHED', 'ACCEPTED_BY_CUSTOMER'], // release cancelled
  DISPATCHED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
} as const satisfies TransitionTable<ConsignmentStatus>
```

Three enforcement layers, deliberately redundant because this is the system's core control:

1. **Domain** — `consignment.transitionTo(next, actor, at, reason?)` throws
   `InvalidStateTransition` for anything not in the table. Exhaustively unit-tested: every
   (from, to) pair is asserted legal or illegal.
2. **Persistence** — status is written only by the repository method that also inserts the
   `consignment_status_history` row. No `UPDATE consignment SET status = …` exists anywhere else,
   and a code-review checklist item plus a grep-based lint rule keeps it that way.
3. **Database** — a `BEFORE UPDATE` trigger rejects a status change whose (old, new) pair is absent
   from a `consignment_transition` lookup table. This catches migrations, scripts and manual DBA
   fixes, which is exactly when the discipline usually breaks.

`STORED → RELEASE_REQUESTED` is intentional: a customer may withdraw unprocessed coffee. Confirm
with EthioStar during the workshop in Next Steps item 2; it is one row in the transition table.

**Lot-level status** exists separately, because a consignment can be partly processed. `Lot` carries
its own smaller lifecycle (`IN_STORE`, `RESERVED_FOR_JOB`, `CONSUMED`, `PRODUCED`, `ACCEPTED`,
`DISPATCHED`), and the consignment status is derived from the aggregate of its lots via an explicit
rule rather than set independently. This avoids the classic bug where the header says `PROCESSED`
while three lots are untouched.

---

## 3.3 Lot lineage — the traceability backbone

_"processing outputs become new lots linked to their parent"_ (glossary).

```
Lot A (RECEIVED, 30,000 kg, 500 kesha, Sidama washed)
  └── job order JO-2026-0041 consumes 30,000 kg
        ├── Lot A-1  APPROVED/EXPORT-READY   24,150 kg   403 kesha
        ├── Lot A-2  C-GRADE                  3,200 kg    54 kesha
        ├── Lot A-3  GRAVITY                  1,450 kg    25 kesha
        ├── Lot A-4  COLOUR SORTER              900 kg    15 kesha
        └── process loss                        300 kg   (dust/chaff/moisture/spillage)
```

`lot_lineage (parent_lot_id, child_lot_id, job_order_id, created_at)` is a closure-friendly edge
table. The "coffee passport" (M07) is a recursive CTE over it joined to the domain event stream.
Modelling lineage as edges rather than a `parent_lot_id` column costs nothing now and supports
future blending and re-processing without a migration.

---

## 3.4 The stock ledger — the single most important decision

**A mutable `quantity_on_hand` column is forbidden as a source of truth.**

Reason: this is a custody business. When a customer disputes a figure six months later, "the column
said 412 bags" is not an answer. The system must be able to show _every movement_ that produced the
figure. A mutable column also loses concurrent updates, cannot be audited retrospectively, and makes
the physical-count variance report impossible to compute honestly.

### Design

```
stock_movement  (APPEND-ONLY — no UPDATE, no DELETE, enforced by trigger + REVOKE)
─────────────────────────────────────────────────────────────────────────────────
  id                 uuid v7
  occurred_at        timestamptz     when it physically happened
  recorded_at        timestamptz     when the system was told (they differ, and that matters)
  movement_type      RECEIPT | PLACEMENT | TRANSFER_OUT | TRANSFER_IN | ISSUE_TO_JOB
                     | OUTPUT_FROM_JOB | PROCESS_LOSS | ADJUSTMENT_IN | ADJUSTMENT_OUT
                     | DISPATCH_OUT | COUNT_VARIANCE
  lot_id             fk
  customer_id        fk    (denormalised deliberately: every ledger query filters by it)
  consignment_id     fk
  location_id        fk    store_section — every kilogram is at a defined location
  quantity_kg        numeric(14,3)   SIGNED: + increases, − decreases
  kesha_count        integer         SIGNED, same convention
  bag_type_id        fk nullable
  reason_code_id     fk nullable     required for ADJUSTMENT_* and COUNT_VARIANCE
  source_type        which document caused this ('goods_receipt','job_order','dispatch',…)
  source_id          uuid            the document's id
  actor_id           fk app_user     who
  witness_id         fk app_user nullable   second person for weighings
  narrative          text nullable
  correlation_id     uuid            groups the movements of one business operation
```

**Invariants enforced in the domain and asserted in tests:**

- A transfer emits exactly two rows (`TRANSFER_OUT` at source, `TRANSFER_IN` at destination) with
  equal magnitude and one `correlation_id`. Sum over a transfer is always zero.
- A job emits `ISSUE_TO_JOB` (negative), `OUTPUT_FROM_JOB` per classification (positive) and
  `PROCESS_LOSS` (**positive**, to a per-warehouse virtual loss location). The signed sum over the
  job's `correlation_id` is zero — _this is the mass balance, expressed as a ledger property._

  The sign of `PROCESS_LOSS` is the detail that is easy to get wrong. Loss is a **destination**,
  not a second withdrawal: stock leaves the input lot and arrives in the output lots _and_ in the
  loss account. Recording it as negative double-counts it against the issue and makes every job
  appear short by exactly the loss. Routing it to a virtual loss location also preserves the M12
  key control — every kilogram remains at a defined location, including the kilograms that became
  dust and chaff.

- Balance for any (lot, location) is `SUM(quantity_kg)` and can never be negative. Checked in the
  domain before write and by a scheduled reconciliation job.
- Nothing may exist without a location. `location_id` is `NOT NULL` — the M12 key control
  ("unallocated stock is not permitted") becomes a schema constraint rather than a habit.

### Balance projection

Summing the ledger on every page load will not survive a season of data. `stock_balance` is a
projection maintained **in the same transaction** as the movement insert:

```
stock_balance (lot_id, location_id) PRIMARY KEY
  customer_id, consignment_id, bag_type_id,
  quantity_kg numeric(14,3), kesha_count integer,
  last_movement_id uuid, updated_at timestamptz
  CHECK (quantity_kg >= 0 AND kesha_count >= 0)
```

Updated with `INSERT … ON CONFLICT DO UPDATE SET quantity_kg = stock_balance.quantity_kg + EXCLUDED…`
which takes a row lock and therefore serialises concurrent movements on the same lot+location
correctly.

A nightly `balance-reconciliation` worker recomputes from the ledger and raises an alert on any
drift. If the projection is ever wrong it can be rebuilt from the ledger; the reverse is not true.
That asymmetry is the whole argument.

---

## 3.5 Capacity engine (M12)

_"Coffee is never accepted against space that does not exist."_

Three quantities at every level of warehouse → room → section:

```
capacity_kg / capacity_kesha        physical maximum
occupied                            Σ stock_balance at or below this node
reserved                            Σ active capacity_reservation
available = capacity × safe_fill_pct − occupied − reserved
```

`safe_fill_pct` is a per-node setting (default from `system_setting`, e.g. 0.90) — the document asks
for "configurable safe-fill thresholds and automatic alerts as a room approaches full".

**Reservations are what make the pre-arrival check honest.** Approving a delivery request creates a
`capacity_reservation` with an expiry (default: expected arrival + N days, configurable). Without
reservations, ten requests approved on Monday all "fit" and none of them do on Friday.

```
capacity_reservation
  id, location_id, delivery_request_id, customer_id,
  quantity_kg, kesha_count,
  status: ACTIVE | CONSUMED | EXPIRED | RELEASED,
  expires_at, created_by, created_at
```

Consumed when the goods receipt is placed; expired by a worker; released on request cancellation.

**Concurrency:** two officers approving requests for the same room at the same instant must not both
succeed. The check-and-reserve runs inside `pg_advisory_xact_lock(hashtext('capacity:' || room_id))`
in the same transaction as the reservation insert. Advisory locking is cheaper than
`SELECT … FOR UPDATE` across a subtree and does not depend on which rows the query happened to
touch. Naïvely doing "SELECT available; if ok INSERT" is a race, and it is the kind of race that
surfaces once a year at the worst moment.

`checkAvailability(quantity, constraints)` returns a **placement proposal** (a list of
section/quantity pairs), not just a boolean — the document asks the system to "either propose a
storage plan or refuse the date with the reason". The proposal strategy lives behind
`PlacementStrategy`, a port with one Phase 1 implementation (best-fit, same-customer-affinity,
fewest-splits). Phase 3's M26 optimal-placement recommender is a second implementation of that same
port and needs no other change.

---

## 3.6 Mass balance and yield (M15)

```
input_kg = Σ ISSUE_TO_JOB
output_kg = Σ OUTPUT_FROM_JOB across the four classifications
loss_kg = Σ PROCESS_LOSS (categorised: dust, chaff, moisture, spillage)

variance_kg  = input_kg − output_kg − loss_kg
variance_pct = |variance_kg| / input_kg × 100
```

- Tolerance is a **runtime setting** (`processing.mass_balance_tolerance_pct`, default 0.5), and is
  overridable per coffee type — a natural sun-dried lot does not behave like a washed one.
- If `variance_pct` exceeds tolerance the job **cannot be closed**. It may be closed with a recorded
  `variance_explanation` plus a `variance_reason_code`, by a user holding
  `job_order:close_with_variance` — a different permission from `job_order:close`. That separation
  is what makes the exception report meaningful.
- `yield_pct` per classification = `output_kg / input_kg × 100`, stored as a snapshot on the job at
  close so that later master-data edits cannot retroactively change a historical yield statement.

Snapshotting is a general rule here, and it comes straight from the M02 key control: _"changing a
tariff does not retrospectively alter invoices already raised under the old rate."_ Every printed
document stores the values it printed.

The four outputs are **rows in `output_classification`**, not a TypeScript enum and not a Postgres
enum, because the document explicitly requires that additional classifications can be added without
redevelopment. Code refers to them by a stable `code` column (`APPROVED`, `C_GRADE`, `GRAVITY`,
`COLOUR_SORTER`), and only `APPROVED` carries the special `is_primary` flag that downstream logic
keys on.

---

## 3.7 Dual-unit recording: kg and kesha

Every quantity is recorded in both units, always, everywhere. This is not redundancy — the two are
independently meaningful:

- **kg** is the commercial quantity and the mass-balance unit.
- **kesha** is the physical count, the basis of labour pay (M18), and the thing the store keeper can
  actually verify at the bay.

```ts
// core/units/conversion.ts
avgKgPerKesha = quantityKg / keshaCount // calculated and displayed on every receipt
```

`bag_type.standard_net_weight_kg` is the _assumed_ weight, effective-dated. The document requires
"the ability to record actual rather than assumed weight" — so `quantity_kg` is always the actual
weighed figure, and the standard weight is used only for estimation and for flagging outliers
(`|avg − standard| / standard > threshold` → soft warning at capture, hard flag on the exception
report). Never derive a recorded weight from a bag count.

---

## 3.8 Labour piece-rate (M18)

Key control from the document: _"Labour payment is always calculated from the store keeper's
confirmed kesha count — there is no independent quantity entry for payroll purposes."_

Modelled so that this cannot be violated:

```
labour_activity
  id, activity_type (UNLOADING_FROM_TRUCK | LOADING_TO_LINE | LOADING_TO_TRUCK
                     | STACKING | RE_BAGGING),
  gang_id, shift_id, performed_on date,
  source_type, source_id,        -- goods_receipt / job_order / dispatch
  kesha_count integer,           -- DERIVED. Written only by the event handler.
  bag_weight_class_id, piece_rate_version_id,
  gross_amount, split_method (EQUAL | BY_INDIVIDUAL_COUNT),
  status DRAFT | APPROVED | VOUCHERED | PAID
```

`kesha_count` has **no UI input control anywhere.** It is populated by the handler for
`KeshaCountConfirmed` / `JobOutputsRecorded` / `DispatchLoaded`. A correction to the underlying
operational count raises a _new_ `labour_activity` adjustment referencing the original, rather than
editing it, so the voucher history stays explicable.

`piece_rate` is effective-dated and versioned; an activity stores the `piece_rate_version_id` it was
priced under, so re-running an old voucher reproduces the old figure exactly.

---

## 3.9 Bag reconciliation (M13)

```
bags_received + bags_issued = bags_filled + bags_returned + bags_condemned + variance
```

Reconciled per consignment and per job. `variance ≠ 0` requires an explanation before the
reconciliation can be marked `RECONCILED`. Customer-owned bags are tracked on a separate ownership
axis (`bag_ownership: ETHIOSTAR | CUSTOMER`) because returnable customer bags must be given back at
dispatch and must never be consumed as EthioStar stock.

---

## 3.10 Domain events (Phase 1 catalogue)

Events are the integration mechanism between modules, the audit substrate, and — as
[07-extension-points.md](07-extension-points.md) explains — the reason Phase 2 billing and Phase 3
AI can be added without re-instrumenting Phase 1 code.

| Event                        | Emitted by  | Phase 1 subscribers                                                                     |
| ---------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| `ApplicationSubmitted`       | onboarding  | notification (ack + tracking ref)                                                       |
| `ApplicationApproved`        | onboarding  | identity (create user + credentials), notification, customers                           |
| `ApplicationRejected`        | onboarding  | notification                                                                            |
| `CustomerDocumentExpiring`   | worker scan | notification, customers (set hold)                                                      |
| `DeliveryRequestSubmitted`   | inbound     | notification                                                                            |
| `DeliveryRequestApproved`    | inbound     | warehouse (reserve), consignment (→ACCEPTED), notification, printing                    |
| `DeliveryRequestRejected`    | inbound     | notification                                                                            |
| `ConsignmentReceived`        | inbound     | consignment (→RECEIVED), stock, printing (GRN), notification                            |
| `KeshaCountConfirmed`        | inbound     | labour (activity), kesha (bag ledger)                                                   |
| `ConsignmentStored`          | inbound     | consignment (→STORED), stock (placement), warehouse (consume reservation), notification |
| `StockTransferred`           | stock       | audit, printing (transfer note)                                                         |
| `StockAdjusted`              | stock       | audit, administration (exception register)                                              |
| `ProcessingRequestSubmitted` | scheduling  | notification                                                                            |
| `AppointmentScheduled`       | scheduling  | consignment (→SCHEDULED), notification, printing                                        |
| `AppointmentRescheduled`     | scheduling  | notification (**delay notice — Stage 3 requirement**)                                   |
| `JobStarted`                 | processing  | consignment (→IN_PROCESS), stock (issue), labour                                        |
| `JobOutputsRecorded`         | processing  | stock (outputs + loss), kesha, labour                                                   |
| `JobClosed`                  | processing  | consignment (→PROCESSED), printing (completion + yield), notification                   |
| `AcceptancePackIssued`       | acceptance  | notification (awaiting signature)                                                       |
| `AcceptanceSigned`           | acceptance  | consignment (→ACCEPTED_BY_CUSTOMER), printing (Mirt Merekebiya)                         |
| `ReleaseRequested`           | dispatch    | consignment (→RELEASE_REQUESTED), notification                                          |
| `DispatchScheduled`          | dispatch    | notification                                                                            |
| `GatePassIssued`             | dispatch    | printing                                                                                |
| `VehicleDeparted`            | dispatch    | stock (deduct), consignment (→DISPATCHED), notification                                 |
| `ConsignmentClosed`          | consignment | notification                                                                            |

Every event carries a common envelope: `eventId`, `name`, `version`, `occurredAt`, `actorId`,
`correlationId`, `causationId`, `aggregateType`, `aggregateId`, `payload`. Events are **versioned
from the first one written** — adding `version: 1` now costs nothing; retrofitting it onto a
production event store costs a migration and a compatibility shim.

---

## 3.11 The "coffee passport" (M07)

The single-timeline view the document calls for is a query, not a table:

```sql
-- conceptually: union of the event stream and the ledger for a consignment and its lot tree
WITH RECURSIVE lot_tree AS (
  SELECT id FROM lot WHERE consignment_id = $1
  UNION ALL
  SELECT ll.child_lot_id FROM lot_lineage ll JOIN lot_tree lt ON ll.parent_lot_id = lt.id
)
SELECT … FROM domain_event  WHERE aggregate_id IN (…)
UNION ALL
SELECT … FROM stock_movement WHERE lot_id IN (SELECT id FROM lot_tree)
ORDER BY occurred_at;
```

Because it is derived from the append-only sources, the passport cannot disagree with the record —
which is precisely its evidential value. It is exposed as a staff page, a customer portal view
(scoped to their own consignments) and a QR target.

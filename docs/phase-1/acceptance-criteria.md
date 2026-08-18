# Phase 1 — Acceptance Criteria

Traced to the client document. Every **key control** it states is listed, with where it is enforced
and how it is tested. This is the checklist UAT signs against.

Legend: **KC** = the document's stated "Key control" for that module.

---

## M01 — Identity, Access & Role Management

| #   | Criterion                                                                                       | Enforced in                                                                                  | Test                                       |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1.1 | **KC:** every action is attributable to a named user; no shared or generic operational accounts | `fn_audit_row` raises when `app.actor_id` is unset; account creation requires a named person | int: write without actor context fails     |
| 1.2 | Permissions are `<resource>:<action>`, grouped into roles, roles assigned to users              | `identity` module; catalogue in code, mapping in DB                                          | unit + int                                 |
| 1.3 | The twelve named roles exist and are configurable                                               | seed `020-roles.ts` + admin UI                                                               | e2e authorization matrix                   |
| 1.4 | Data scoping: a store keeper of Room A cannot post movements in Room B                          | `requirePermission(..., { roomId })` + `applyScope` on reads                                 | int: scoped user denied out-of-scope write |
| 1.5 | Auditor is read-only                                                                            | role definition                                                                              | unit: Auditor holds no non-read permission |
| 1.6 | Deny by default                                                                                 | `authorize.ts`                                                                               | unit                                       |
| 1.7 | Sessions are revocable and revocation is immediate                                              | DB-backed sessions                                                                           | int                                        |
| 1.8 | Forced first-login password change cannot be bypassed                                           | proxy redirect + use-case guard                                                              | e2e                                        |
| 1.9 | MFA required for admin, GM, finance and stock-adjust holders                                    | policy                                                                                       | int                                        |

## M02 — Organisation & Master Data

| #   | Criterion                                                                                                             | Enforced in                                              | Test                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| 2.1 | **KC:** master data is versioned with effective dates; a rate change does not alter records raised under the old rate | `*_version` tables + stored `version_id` on transactions | int: reprint an old voucher after a rate change → original amount |
| 2.2 | Coffee master: type, origin region and woreda, harvest year, grade, screen size, certification                        | schema + UI                                              | e2e                                                               |
| 2.3 | The four output classifications are configurable records; a fifth can be added without code change                    | `output_classification` lookup table                     | e2e: add a classification via UI and record an output against it  |
| 2.4 | kg is the base unit, kesha the counted unit; configurable standard net weight per bag type; actual weight recordable  | `core/units`, `bag_type_version`                         | unit + int                                                        |
| 2.5 | No overlapping effective-date versions                                                                                | `EXCLUDE USING gist`                                     | int                                                               |

## M04 — Notification & Communication

| #   | Criterion                                                                                                 | Enforced in                      | Test                                        |
| --- | --------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------- |
| 4.1 | **KC:** notifications are never deleted; the log is evidentiary                                           | append-only trigger + `REVOKE`   | int: DELETE raises                          |
| 4.2 | On customer approval, credentials are issued by email with a forced first-login change                    | `ApplicationApproved` handler    | e2e journey 1                               |
| 4.3 | When an appointment moves, affected customers are notified automatically with the new date and the reason | `AppointmentRescheduled` handler | e2e journey 3                               |
| 4.4 | All listed event triggers fire                                                                            | subscriber registry              | int, one per template                       |
| 4.5 | The rendered body is stored, not just a template reference                                                | `notification.body_rendered`     | int: edit template, prior message unchanged |
| 4.6 | Delivery is retried and dead-lettered, not silently lost                                                  | queue                            | int                                         |

## M06 — Printing, Labelling & Barcode/QR

| #   | Criterion                                                                                                               | Enforced in                             | Test                         |
| --- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------- |
| 6.1 | **KC:** every printed document carries a system-generated number, a print timestamp and the printing user's name        | `Footer` primitive + `printed_document` | golden PDF test per document |
| 6.2 | All Phase 1 operational documents render                                                                                | `platform/pdf` templates                | golden tests                 |
| 6.3 | Labels and hanging tags carry customer, consignment, lot, type, grade, net weight, kesha, room/section, processing date | label templates                         | golden test                  |
| 6.4 | A unique QR per consignment and per lot; scanning shows full history                                                    | `qr_token` + scan route                 | e2e                          |
| 6.5 | Numbering is gapless under concurrency; a rollback does not consume a number                                            | `FOR UPDATE` allocation                 | int, concurrent              |
| 6.6 | Reprints are watermarked DUPLICATE and counted                                                                          | `renderDocument` reprint path           | golden test                  |
| 6.7 | An old document reprints with its original figures                                                                      | `payload_snapshot`                      | int                          |

## M07 — Audit Trail, Compliance & Traceability

| #   | Criterion                                                                                                                                         | Enforced in                                                  | Test                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| 7.1 | **KC:** audit records cannot be edited or deleted by any role                                                                                     | trigger + `REVOKE` on `authenticated` **and** `service_role` | int, run as both — `service_role` bypasses RLS but not triggers |
| 7.2 | Coffee passport: one timeline covering request → arrival → weighing → storage → every transfer → processing → each output → acceptance → dispatch | recursive CTE over lineage + events + movements              | e2e                                                             |
| 7.3 | Every create/update/approve/reject/cancel/print/adjust/delete-attempt is recorded with user, timestamp, IP and device                             | `fn_audit_row` + `withAction` context                        | int                                                             |
| 7.4 | Before-and-after values for every changed field                                                                                                   | JSONB diff in `audit_log`                                    | int: change a weight, assert both values                        |

## M08 — Customer Onboarding, KYC & Document Verification

| #   | Criterion                                                                                                                                                                            | Enforced in                | Test          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | ------------- |
| 8.1 | **KC:** an application cannot be approved while any mandatory document is unverified or expired                                                                                      | `approveApplication` guard | int + e2e     |
| 8.2 | Public application without an account; tracking reference issued immediately                                                                                                         | `(public)/apply` + API     | e2e journey 1 |
| 8.3 | Full applicant profile captured (company, trade name, business type, TIN, VAT, trade licence, address, region, phone, email, bank details, authorised contacts with position and ID) | schema + wizard            | e2e           |
| 8.4 | Document checklist configurable per business type                                                                                                                                    | `kyc_document_requirement` | e2e           |
| 8.5 | On approval: customer created, account created, credentials emailed                                                                                                                  | event chain                | e2e journey 1 |
| 8.6 | Uploads are virus-scanned and restricted to approved formats and sizes                                                                                                               | `files` module             | int           |

## M09 — Customer Self-Service Portal

| #   | Criterion                                                                                                                                                           | Enforced in                          | Test                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| 9.1 | **KC:** a customer sees only their own data, enforced at the data layer                                                                                             | explicit scoping **and** RLS         | int: cross-tenant probe; int: RLS holds with app filter removed |
| 9.2 | Dashboard: total held in kg and kesha split by status; upcoming appointments; pending actions; recent activity                                                      | `dashboard.query.ts`                 | e2e                                                             |
| 9.3 | Submit a delivery request online with coffee type, origin, quantity in kg and kesha, expected arrival, transporter, vehicle, and the signed request letter attached | portal + `inbound`                   | e2e journey 2                                                   |
| 9.4 | Live stock view: consignment, lot, type, grade, quantity, and room/section at EthioStar's discretion                                                                | `stock` query + a visibility setting | e2e                                                             |
| 9.5 | Outstanding balance is absent, not shown as zero (Phase 2)                                                                                                          | dashboard read model                 | visual review                                                   |

## M11 — Inbound Delivery Request & Goods Receiving

| #    | Criterion                                                                                                            | Enforced in                     | Test           |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------- | -------------- |
| 11.1 | **KC:** no coffee may be received without an approved delivery request                                               | `createGoodsReceipt` guard + FK | int            |
| 11.2 | Pre-arrival capacity check across warehouses, rooms and sections; proposes a storage plan or refuses with the reason | `checkAvailability`             | int + e2e      |
| 11.3 | Store keeper records and confirms actual kesha unloaded, by bag type and condition                                   | `confirmKeshaCount`             | e2e journey 2  |
| 11.4 | Every receipt records kg and kesha simultaneously, with average per kesha shown                                      | schema + UI                     | int            |
| 11.5 | The confirmed count is what M18 pays from                                                                            | event handler; no manual path   | int (see 18.1) |
| 11.6 | Weighing records a second-person witness                                                                             | `weighing_record.witness_id`    | int            |

## M12 — Warehouse, Room & Section Management

| #    | Criterion                                                                                                 | Enforced in                           | Test            |
| ---- | --------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------- |
| 12.1 | **KC:** every kilogram is at a defined location; unallocated stock is not permitted                       | `stock_movement.location_id NOT NULL` | int             |
| 12.2 | Three-level structure, each with code, description, dimensions and capacity in kg and kesha               | schema                                | int             |
| 12.3 | Live occupied, reserved and available at every level; configurable safe-fill thresholds; automatic alerts | `CapacityCalculator` + worker scan    | int + e2e       |
| 12.4 | Pre-acceptance availability check returns yes/no plus a suggested placement                               | `checkAvailability`                   | int             |
| 12.5 | Concurrent reservations cannot oversubscribe a room                                                       | advisory lock                         | int, concurrent |

## M13 — Kesha (Coffee Bag) Management

| #    | Criterion                                                                                        | Enforced in                             | Test                  |
| ---- | ------------------------------------------------------------------------------------------------ | --------------------------------------- | --------------------- |
| 13.1 | **KC:** bags received + issued = filled + returned + condemned; any difference must be explained | `BagReconciliation` domain              | unit (property) + int |
| 13.2 | Empty bag inventory by type and location, with receipt, issue and running balance                | `kesha` module                          | int                   |
| 13.3 | Customer-owned bags tracked separately, including returnables given back on dispatch             | `bag_ownership` + dispatch loading list | e2e journey 4         |

## M14 — Appointment & Production Scheduling

| #    | Criterion                                                                                                                                     | Enforced in                           | Test            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------- |
| 14.1 | **KC:** a processing request cannot be scheduled for lots not physically in store                                                             | eligibility specification             | int             |
| 14.2 | Customer selects stored lots, quantity, special instruction and preferred date                                                                | portal                                | e2e journey 3   |
| 14.3 | Eligibility confirms lots are in store, not already committed, and the customer is not blocked by an expired document                         | specifications + `CustomerHoldPolicy` | int             |
| 14.4 | Reschedule records the reason and category, cascades onto downstream jobs, and immediately notifies every affected customer with the new date | `rescheduleAppointment`               | e2e journey 3   |
| 14.5 | Two appointments cannot overlap on one production line                                                                                        | `EXCLUDE USING gist`                  | int, concurrent |

## M15 — Processing Execution & Output Classification

| #    | Criterion                                                                                                               | Enforced in                        | Test           |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------- |
| 15.1 | **KC:** a job cannot be closed while the mass balance is outside tolerance and unexplained                              | `closeJob` guard                   | unit + int     |
| 15.2 | Four output streams each recorded with kg, kesha, bag type and destination location                                     | `job_output`                       | e2e journey 3  |
| 15.3 | Input compared against outputs plus recorded process loss; unexplained difference beyond tolerance is flagged           | `MassBalance`                      | unit           |
| 15.4 | Operator formally accepts and starts the job, timestamped; cannot start before the scheduled window without an override | `startJob` + a distinct permission | int            |
| 15.5 | The signed ledger sum over a job is exactly zero                                                                        | ledger invariant                   | int (property) |
| 15.6 | Yields are snapshotted at close                                                                                         | `job_mass_balance`                 | int            |

## M16 — Customer Acceptance & Mirt Merekebiya

| #    | Criterion                                                                                                                   | Enforced in            | Test                    |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------- |
| 16.1 | **KC:** coffee cannot be dispatched until the corresponding outputs are accepted                                            | dispatch clearance     | int (asserted from M17) |
| 16.2 | Mirt Merekebiya generated automatically from recorded figures, with a unique number and both signature blocks               | `printing` template    | golden test             |
| 16.3 | Acceptance pack shows input weight, each output with weight and kesha, yield percentages, process loss and storage location | pack assembler         | e2e journey 3           |
| 16.4 | Portal signature records identity, timestamp and IP; wet-ink scan produces the same auditable outcome                       | `acceptance_signature` | int, both routes        |

## M17 — Outbound Dispatch, Gate Pass & Delivery

| #    | Criterion                                                                                                                                          | Enforced in                   | Test                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------ |
| 17.1 | **KC:** no dispatch without acceptance recorded in M16                                                                                             | clearance check               | int                      |
| 17.2 | Release request nominates quantity, destination, transporter, vehicle, driver and preferred date, with authorisation attached                      | portal                        | e2e journey 4            |
| 17.3 | Clearance verifies lots are accepted and the customer has no hold                                                                                  | `CustomerHoldPolicy`          | int, blocked case        |
| 17.4 | A numbered gate pass is issued; the officer verifies the vehicle, scans the QR and records gate-out; no vehicle leaves without a valid unused pass | `gate_pass` status transition | int, double-use rejected |
| 17.5 | Stock is deducted at the moment of departure                                                                                                       | `VehicleDeparted` handler     | int                      |
| 17.6 | Returnable customer bags appear on the loading list                                                                                                | loading list template         | golden test              |

## M18 — Labour & Piece-Rate Payment

| #    | Criterion                                                                                                                                     | Enforced in                                  | Test                                          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| 18.1 | **KC:** labour payment is always calculated from the store keeper's confirmed kesha count; there is no independent quantity entry for payroll | `kesha_count` written only by event handlers | architecture test: no other write path exists |
| 18.2 | Earnings = confirmed count × applicable rate, split equally or by individual count                                                            | `PieceRateCalculator`                        | unit                                          |
| 18.3 | Rates differentiated by activity, bag weight class and shift, including overtime, night and holiday premiums                                  | `piece_rate_version`                         | unit                                          |
| 18.4 | An old voucher reproduces its original amount                                                                                                 | stored `piece_rate_version_id`               | int                                           |

## M23 — System Administration, Configuration & Support Desk

| #    | Criterion                                                                                                                                                    | Enforced in              | Test                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | -------------------------------------------- |
| 23.1 | **KC:** every configuration change is logged with the user, the old value and the new value                                                                  | `system_setting_history` | int                                          |
| 23.2 | Business rules, tolerances, thresholds, free days, approval limits and numbering series are maintainable by an authorised administrator without code changes | settings console         | e2e: change tolerance, observe new behaviour |
| 23.3 | Governance reports: user access and dormant account review, approval turnaround, stock adjustment audit, exception register, configuration change history    | admin views              | e2e                                          |

---

## Cross-cutting acceptance

| #    | Criterion                                                                                      | Test                                |
| ---- | ---------------------------------------------------------------------------------------------- | ----------------------------------- |
| X.1  | The lifecycle permits no skipped state, and every transition is logged with user and timestamp | exhaustive transition test + int    |
| X.2  | `stock_balance` reconciles exactly with the ledger for every lot and location                  | int (property) + nightly job        |
| X.3  | A consignment's full history is reconstructable from `domain_event` + `stock_movement` alone   | int                                 |
| X.4  | No business quantity is stored or computed as a float                                          | lint rule + code review             |
| X.5  | All timestamps are `timestamptz`; business dates use `Africa/Addis_Ababa`                      | schema check + unit                 |
| X.6  | RLS isolates customers under connection pooling                                                | int, interleaved transactions       |
| X.7  | Every use case that writes calls `requirePermission`                                           | architecture test                   |
| X.8  | Every document renders correctly in both `en` and `am`                                         | golden tests, both locales          |
| X.9  | Receiving and gate screens are usable on a 7-inch tablet                                       | manual + Playwright mobile viewport |
| X.10 | A restore drill completes within the RTO                                                       | documented drill                    |

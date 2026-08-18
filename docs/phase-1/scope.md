# Phase 1 — Scope

**Objective (from the client document):** _"run the physical business end to end in the system, from
customer admission to dispatch."_

**Outcome required:** every consignment tracked digitally; every operational document printed from
the system; customers have their own dashboards and submit their own requests; labour paid from
confirmed counts.

---

## In scope — the sixteen modules

| Code | Module                                              | Layer        | Pri | Notes on Phase 1 depth                                                 |
| ---- | --------------------------------------------------- | ------------ | --- | ---------------------------------------------------------------------- |
| M01  | Identity, Access & Role Management                  | Core         | E   | Full: RBAC, 12 roles, data scoping, sessions, MFA for privileged roles |
| M02  | Organisation & Master Data                          | Core         | E   | Full, including effective-dated versioning                             |
| M04  | Notification & Communication                        | Core         | E   | Email channel only; full template/log/retry machinery                  |
| M06  | Printing, Labelling & Barcode/QR                    | Core         | E   | Full, minus the four finance documents (M19, Phase 2)                  |
| M07  | Audit Trail, Compliance & Traceability              | Core         | E   | Full, including the coffee-passport view                               |
| M08  | Customer Onboarding, KYC & Document Verification    | Customer     | E   | Full                                                                   |
| M09  | Customer Self-Service Portal                        | Customer     | E   | Full, minus outstanding-balance figures (M19)                          |
| M11  | Inbound Delivery Request & Goods Receiving          | Operations   | E   | Full                                                                   |
| M12  | Warehouse, Room & Section Management                | Operations   | E   | Full, including capacity engine and reservations                       |
| M13  | Kesha (Coffee Bag) Management                       | Operations   | E   | Full                                                                   |
| M14  | Appointment & Production Scheduling                 | Operations   | E   | Full; eligibility excludes the financial hold (M19)                    |
| M15  | Processing Execution & Output Classification        | Operations   | E   | Full                                                                   |
| M16  | Customer Acceptance & Mirt Merekebiya               | Operations   | E   | Full; portal-click + wet-ink signature (cryptographic e-sign is M05)   |
| M17  | Outbound Dispatch, Gate Pass & Delivery             | Operations   | E   | Full; clearance excludes the financial hold (M19)                      |
| M18  | Casual Labour & Piece-Rate Payment                  | Operations   | E   | Full                                                                   |
| M23  | System Administration, Configuration & Support Desk | Intelligence | E   | Full configuration console; minimal support-desk ticketing             |

---

## Explicitly out of scope for Phase 1

| Code    | Module                               | Phase |
| ------- | ------------------------------------ | ----- |
| M03     | Workflow & Approval Engine           | 2     |
| M05     | Document Management & e-Signature    | 2     |
| M10     | Contract, Tariff & Service Agreement | 2     |
| M19     | Billing, Invoicing & Receivables     | 2     |
| M20     | Storage & Demurrage Charging         | 2     |
| M21     | Reporting, Dashboards & BI           | 2     |
| M22     | Mobile Application                   | 2     |
| M24–M28 | AI & Intelligent Automation          | 3     |

Plus everything in the document's §2.3 out-of-scope list: general ledger and tax filing, HR/payroll,
laboratory quality analysis and cupping, plant maintenance, hardware integration (weighbridge,
sorter feeds, SMS gateways, accounting/banking interfaces), offline mobile operation, PLC/SCADA,
customs filing, and coffee trading.

---

## Boundary rulings

Places where Phase 1 and Phase 2 touch, and the decision made. Each of these would otherwise be
argued about mid-build.

| #   | Question                                                  | Ruling                                                                                                                                                                               |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | M08 needs document upload; M05 is Phase 2                 | Build a **minimal file service** (`stored_file` + `file_link` + scan + expiry). It is a prerequisite for an M08 key control, not a partial M05. M05 extends it.                      |
| B2  | M11/M08 need approvals; M03 is Phase 2                    | Hardcode the two approval flows behind an `ApprovalPolicy` port with a threshold-driven Phase 1 implementation. Approval decisions are rows, with a nullable `workflow_instance_id`. |
| B3  | M14/M17 must block on "overdue balance"; M19 is Phase 2   | `CustomerHoldPolicy` port. Phase 1 implements document-compliance and manual holds. Financial hold is added as a second policy in Phase 2.                                           |
| B4  | M09 dashboard shows "outstanding balance"; M19 is Phase 2 | The tile is **not shown** in Phase 1 (not shown as zero — a wrong number is worse than an absent one). The dashboard read model has the slot.                                        |
| B5  | M16 needs e-signature; M05 is Phase 2                     | Portal-click acceptance with recorded identity, timestamp and IP — exactly what the document describes for M16 — plus scan-and-attach. Cryptographic signing is M05's addition.      |
| B6  | M09/M23 need dashboards; M21 is Phase 2                   | Build **operational read models** (worklists, portal dashboard, occupancy). Do not build an ad-hoc report builder, BI or a chart library beyond simple figures.                      |
| B7  | M06 lists proforma/tax invoice/receipt/statement          | Those four are M19 documents. The numbering series and renderer support them; the templates are not built.                                                                           |
| B8  | M13 bag _costing_                                         | Bags are tracked as inventory in Phase 1. Valuing them is commercial (Phase 2).                                                                                                      |
| B9  | Storage dwell time                                        | `lot.storage_start_date` and `dispatch.departed_at` are **recorded** in Phase 1 (ageing reports need them and they cannot be backfilled). Charging is M20.                           |
| B10 | Mobile data capture (M22)                                 | Not built. But the receiving and gate screens are built **mobile-responsive**, because they are used on the floor and this is a UI choice, not a module.                             |

---

## Definition of done for Phase 1

Phase 1 is complete when all of the following are true:

1. The four E2E journeys in [../architecture/08-testing.md §8.2](../architecture/08-testing.md) pass
   against a production-shaped dataset.
2. Every one of the nineteen Phase 1 documents renders, is numbered, is recorded in
   `printed_document`, and reprints as a watermarked duplicate.
3. A consignment's full history is reconstructable from `domain_event` + `stock_movement` alone, and
   the coffee passport renders it on one timeline.
4. `stock_balance` reconciles exactly with the ledger for every lot and location.
5. All twelve roles exist with a reviewed permission set, and the authorization matrix E2E test
   passes.
6. RLS isolation is verified under connection pooling.
7. Every business rule listed in [acceptance-criteria.md](acceptance-criteria.md) has at least one
   automated test.
8. A restore drill has been completed and timed.
9. The operational runbooks in [../architecture/09-operations.md §9.7](../architecture/09-operations.md)
   are written.
10. UAT sign-off from Operations, Store and Finance against the document's Stage 1–4 process.

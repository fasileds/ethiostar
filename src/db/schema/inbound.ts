import { pgTable, text, uuid, index, uniqueIndex, check, integer } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  appendOnlyColumns,
  occurrenceColumns,
  weightKg,
  keshaCount,
  percent,
  instant,
  calendarDate,
} from '../helpers/columns'
import { branch, coffeeType, coffeeGrade, woreda, harvestYear, bagType } from './master-data'
import { customer } from './customer'
import { consignment, lot } from './consignment'
import { storeSection } from './warehouse'
import { storedFile } from './files'

/**
 * M11 — Inbound Coffee Reception.
 *
 * The chain the client describes: a customer's request letter, an approval that reserves
 * space, a gate pass, a weighbridge, an inspection, and a signed goods receipt.
 *
 * The load-bearing rule is that the GOODS RECEIPT — not the request, not the gate pass — is
 * what creates stock. Everything before it is an expectation; only the receipt asserts that
 * a specific number of kilograms is now in EthioStar's custody at a specific location, and
 * only the receipt writes to the ledger.
 */

export const deliveryRequest = pgTable(
  'delivery_request',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),

    /** DRAFT → SUBMITTED → APPROVED | REJECTED → SCHEDULED → ARRIVED → RECEIVED | CANCELLED */
    status: text('status').notNull().default('DRAFT'),

    coffeeTypeId: uuid('coffee_type_id').references(() => coffeeType.id),
    coffeeGradeId: uuid('coffee_grade_id').references(() => coffeeGrade.id),
    originWoredaId: uuid('origin_woreda_id').references(() => woreda.id),
    harvestYearId: uuid('harvest_year_id').references(() => harvestYear.id),
    bagTypeId: uuid('bag_type_id').references(() => bagType.id),

    declaredQuantityKg: weightKg('declared_quantity_kg').notNull(),
    declaredKeshaCount: keshaCount('declared_kesha_count').notNull(),
    expectedArrivalOn: calendarDate('expected_arrival_on').notNull(),
    /** Narrow window helps the yard; nullable because not every customer can commit to one. */
    expectedArrivalWindow: text('expected_arrival_window'),

    transportMode: text('transport_mode'),
    vehiclePlate: text('vehicle_plate'),
    driverName: text('driver_name'),
    driverPhone: text('driver_phone'),

    /** The customer's request letter — the document the whole chain starts from. */
    requestLetterFileId: uuid('request_letter_file_id').references(() => storedFile.id),

    submittedAt: instant('submitted_at'),
    approvedBy: uuid('approved_by'),
    approvedAt: instant('approved_at'),
    rejectionReason: text('rejection_reason'),
    cancelledAt: instant('cancelled_at'),
    cancelledReason: text('cancelled_reason'),

    /** Where the approval reserved space. Points at capacity_reservation. */
    reservationId: uuid('reservation_id'),
    /** The consignment created on approval — the spine this request feeds. */
    consignmentId: uuid('consignment_id').references(() => consignment.id),

    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_delivery_request__reference').on(t.reference),
    index('idx_delivery_request__customer').on(t.customerId, t.createdAt),
    index('idx_delivery_request__status').on(t.status, t.expectedArrivalOn),
    index('idx_delivery_request__branch').on(t.branchId),
    index('idx_delivery_request__consignment').on(t.consignmentId),
    // The approval queue, which is the screen a supervisor lives on.
    index('idx_delivery_request__pending')
      .on(t.expectedArrivalOn)
      .where(sql`${t.status} = 'SUBMITTED'`),
    check(
      'ck_delivery_request__status',
      sql`${t.status} in ('DRAFT','SUBMITTED','APPROVED','REJECTED','SCHEDULED','ARRIVED','RECEIVED','CANCELLED')`,
    ),
    check('ck_delivery_request__quantity', sql`${t.declaredQuantityKg} > 0`),
    check('ck_delivery_request__kesha', sql`${t.declaredKeshaCount} > 0`),
  ],
)

/**
 * The gate pass — permission for one vehicle to enter on one day.
 *
 * Issued on approval, scanned at the gate. It exists so the guard has a yes/no answer
 * without a phone call, and so an arrival that was never approved is visible immediately
 * rather than discovered at the weighbridge.
 */
export const gatePass = pgTable(
  'gate_pass',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    deliveryRequestId: uuid('delivery_request_id')
      .notNull()
      .references(() => deliveryRequest.id),
    /** Encoded into the QR code. Random, so a pass cannot be forged by incrementing. */
    scanToken: text('scan_token').notNull(),
    validOn: calendarDate('valid_on').notNull(),
    validUntil: instant('valid_until').notNull(),
    vehiclePlate: text('vehicle_plate'),
    driverName: text('driver_name'),
    /** ISSUED | USED | EXPIRED | REVOKED */
    status: text('status').notNull().default('ISSUED'),
    usedAt: instant('used_at'),
    revokedReason: text('revoked_reason'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_gate_pass__reference').on(t.reference),
    uniqueIndex('uq_gate_pass__scan_token').on(t.scanToken),
    index('idx_gate_pass__request').on(t.deliveryRequestId),
    index('idx_gate_pass__valid_on').on(t.validOn, t.status),
    check('ck_gate_pass__status', sql`${t.status} in ('ISSUED','USED','EXPIRED','REVOKED')`),
  ],
)

/**
 * A weighbridge reading.
 *
 * Gross and tare are recorded SEPARATELY and net is derived, never entered. A hand-entered
 * net is unauditable: when it disagrees with the bag count nobody can tell which of the two
 * numbers was wrong.
 */
export const weighbridgeTicket = pgTable(
  'weighbridge_ticket',
  {
    id: uuid('id').primaryKey(),
    ticketNo: text('ticket_no').notNull(),
    deliveryRequestId: uuid('delivery_request_id').references(() => deliveryRequest.id),
    vehiclePlate: text('vehicle_plate').notNull(),

    grossWeightKg: weightKg('gross_weight_kg').notNull(),
    tareWeightKg: weightKg('tare_weight_kg').notNull(),
    /** Generated by the database, so it cannot drift from its inputs. */
    netWeightKg: weightKg('net_weight_kg').generatedAlwaysAs(
      sql`gross_weight_kg - tare_weight_kg`,
    ),

    weighedInAt: instant('weighed_in_at').notNull(),
    weighedOutAt: instant('weighed_out_at'),
    /** MANUAL when typed from the printed ticket, DEVICE when read from the bridge. */
    captureMethod: text('capture_method').notNull().default('MANUAL'),
    scaleId: text('scale_id'),
    operatorNote: text('operator_note'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_weighbridge_ticket__no').on(t.ticketNo),
    index('idx_weighbridge_ticket__request').on(t.deliveryRequestId),
    check('ck_weighbridge_ticket__gross', sql`${t.grossWeightKg} > 0`),
    check('ck_weighbridge_ticket__tare', sql`${t.tareWeightKg} >= 0`),
    check('ck_weighbridge_ticket__net', sql`${t.grossWeightKg} > ${t.tareWeightKg}`),
    check('ck_weighbridge_ticket__capture', sql`${t.captureMethod} in ('MANUAL','DEVICE')`),
  ],
)

/**
 * The goods receipt — the moment coffee becomes EthioStar's responsibility.
 *
 * This row and its lines are what write the stock ledger. `varianceKg` is stored rather than
 * derived on read because the tolerance in force at the time is a business fact: changing the
 * tolerance later must not retroactively make a past receipt compliant.
 */
export const goodsReceipt = pgTable(
  'goods_receipt',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    consignmentId: uuid('consignment_id')
      .notNull()
      .references(() => consignment.id),
    deliveryRequestId: uuid('delivery_request_id').references(() => deliveryRequest.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),

    /** DRAFT → CONFIRMED → POSTED | CANCELLED. Only POSTED has touched the ledger. */
    status: text('status').notNull().default('DRAFT'),

    weighbridgeTicketId: uuid('weighbridge_ticket_id').references(() => weighbridgeTicket.id),
    vehiclePlate: text('vehicle_plate'),
    driverName: text('driver_name'),

    receivedQuantityKg: weightKg('received_quantity_kg').notNull(),
    receivedKeshaCount: keshaCount('received_kesha_count').notNull(),
    declaredQuantityKg: weightKg('declared_quantity_kg'),
    declaredKeshaCount: keshaCount('declared_kesha_count'),
    varianceKg: weightKg('variance_kg'),
    variancePct: percent('variance_pct'),
    /** The tolerance that applied at the time, copied in deliberately. */
    toleranceAppliedPct: percent('tolerance_applied_pct'),
    varianceApprovedBy: uuid('variance_approved_by'),
    varianceApprovedAt: instant('variance_approved_at'),
    varianceReason: text('variance_reason'),

    /** Where it was put. Must be a real section — no unallocated stock (M12). */
    locationId: uuid('location_id').references(() => storeSection.id),

    ...occurrenceColumns(),
    receivedBy: uuid('received_by').notNull(),
    /** Signed by the customer's representative at the bay. */
    customerRepName: text('customer_rep_name'),
    customerSignatureFileId: uuid('customer_signature_file_id').references(() => storedFile.id),

    postedAt: instant('posted_at'),
    cancelledAt: instant('cancelled_at'),
    cancelledReason: text('cancelled_reason'),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_goods_receipt__reference').on(t.reference),
    index('idx_goods_receipt__consignment').on(t.consignmentId),
    index('idx_goods_receipt__customer').on(t.customerId, t.occurredAt),
    index('idx_goods_receipt__status').on(t.status),
    index('idx_goods_receipt__occurred').on(t.occurredAt),
    check(
      'ck_goods_receipt__status',
      sql`${t.status} in ('DRAFT','CONFIRMED','POSTED','CANCELLED')`,
    ),
    check('ck_goods_receipt__quantity', sql`${t.receivedQuantityKg} > 0`),
    check('ck_goods_receipt__kesha', sql`${t.receivedKeshaCount} > 0`),
    // A posted receipt must sit at a location — this is the M12 key control at the point
    // where stock is created.
    check(
      'ck_goods_receipt__posted_has_location',
      sql`${t.status} <> 'POSTED' or ${t.locationId} is not null`,
    ),
  ],
)

/**
 * One line per bag class received.
 *
 * A truck rarely carries one uniform thing: the same delivery is 300 jute bags of 60 kg and
 * 40 sisal of 85. Recording a single total loses the kesha reconciliation (M13) entirely.
 */
export const goodsReceiptLine = pgTable(
  'goods_receipt_line',
  {
    id: uuid('id').primaryKey(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => goodsReceipt.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    bagTypeId: uuid('bag_type_id').references(() => bagType.id),
    coffeeTypeId: uuid('coffee_type_id').references(() => coffeeType.id),
    coffeeGradeId: uuid('coffee_grade_id').references(() => coffeeGrade.id),
    quantityKg: weightKg('quantity_kg').notNull(),
    keshaCount: keshaCount('kesha_count').notNull(),
    /** Where this specific line was placed, when it differs from the header. */
    locationId: uuid('location_id').references(() => storeSection.id),
    /** The lot this line became. Set when the receipt posts. */
    lotId: uuid('lot_id').references(() => lot.id),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_goods_receipt_line__no').on(t.receiptId, t.lineNo),
    index('idx_goods_receipt_line__receipt').on(t.receiptId),
    index('idx_goods_receipt_line__lot').on(t.lotId),
    check('ck_goods_receipt_line__quantity', sql`${t.quantityKg} > 0`),
    check('ck_goods_receipt_line__kesha', sql`${t.keshaCount} > 0`),
  ],
)

/**
 * Intake quality inspection.
 *
 * Advisory in Phase 1: it records what was observed and can flag a receipt for supervisor
 * review, but it does not block. Blocking on a moisture reading needs a defined tolerance
 * regime per coffee type, which is M22 in Phase 2.
 */
export const qualityInspection = pgTable(
  'quality_inspection',
  {
    id: uuid('id').primaryKey(),
    receiptId: uuid('receipt_id').references(() => goodsReceipt.id, { onDelete: 'cascade' }),
    consignmentId: uuid('consignment_id').references(() => consignment.id),

    moisturePct: percent('moisture_pct'),
    defectCount: integer('defect_count'),
    screenSizeNote: text('screen_size_note'),
    /** GOOD | FAIR | POOR — the operator's overall read. */
    appearance: text('appearance'),
    foreignMatterPct: percent('foreign_matter_pct'),
    cupScore: percent('cup_score'),

    /** PASS | PASS_WITH_NOTE | FLAGGED */
    verdict: text('verdict').notNull().default('PASS'),
    inspectorNote: text('inspector_note'),
    inspectedBy: uuid('inspected_by').notNull(),
    inspectedAt: instant('inspected_at')
      .notNull()
      .default(sql`now()`),
    ...auditColumns(),
  },
  (t) => [
    index('idx_quality_inspection__receipt').on(t.receiptId),
    index('idx_quality_inspection__consignment').on(t.consignmentId),
    check(
      'ck_quality_inspection__verdict',
      sql`${t.verdict} in ('PASS','PASS_WITH_NOTE','FLAGGED')`,
    ),
    check(
      'ck_quality_inspection__moisture',
      sql`${t.moisturePct} is null or (${t.moisturePct} >= 0 and ${t.moisturePct} <= 100)`,
    ),
  ],
)

/**
 * Vehicle movements at the gate, append-only.
 *
 * Both directions live in one table so "which vehicles are on site right now" is one query
 * rather than a join between two half-tables that disagree.
 */
export const gateEvent = pgTable(
  'gate_event',
  {
    id: uuid('id').primaryKey(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    /** IN | OUT */
    direction: text('direction').notNull(),
    vehiclePlate: text('vehicle_plate').notNull(),
    driverName: text('driver_name'),
    driverIdNo: text('driver_id_no'),

    /** Whichever pass or order authorised this movement. */
    gatePassId: uuid('gate_pass_id').references(() => gatePass.id),
    dispatchOrderId: uuid('dispatch_order_id'),
    deliveryRequestId: uuid('delivery_request_id').references(() => deliveryRequest.id),

    /** SCAN | MANUAL — a manual entry is a deliberate exception and reads as one. */
    captureMethod: text('capture_method').notNull().default('SCAN'),
    manualReason: text('manual_reason'),
    guardNote: text('guard_note'),
    ...occurrenceColumns(),
    ...appendOnlyColumns(),
  },
  (t) => [
    index('idx_gate_event__branch_time').on(t.branchId, t.occurredAt),
    index('idx_gate_event__plate').on(t.vehiclePlate, t.occurredAt),
    index('idx_gate_event__pass').on(t.gatePassId),
    check('ck_gate_event__direction', sql`${t.direction} in ('IN','OUT')`),
    check('ck_gate_event__capture', sql`${t.captureMethod} in ('SCAN','MANUAL')`),
    // A manual override must say why. The field is the whole point of the control.
    check(
      'ck_gate_event__manual_reason',
      sql`${t.captureMethod} <> 'MANUAL' or ${t.manualReason} is not null`,
    ),
  ],
)

/** Append-only status trail for a delivery request. */
export const deliveryRequestStatusHistory = pgTable(
  'delivery_request_status_history',
  {
    id: uuid('id').primaryKey(),
    deliveryRequestId: uuid('delivery_request_id')
      .notNull()
      .references(() => deliveryRequest.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    note: text('note'),
    changedAt: instant('changed_at')
      .notNull()
      .default(sql`now()`),
    changedBy: uuid('changed_by'),
  },
  (t) => [
    index('idx_delivery_request_status_history__request').on(t.deliveryRequestId, t.changedAt),
  ],
)

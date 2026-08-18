import { pgTable, text, uuid, index, uniqueIndex, check, integer } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  weightKg,
  keshaCount,
  instant,
  calendarDate,
  activeFlag,
} from '../helpers/columns'
import { branch, bagType } from './master-data'
import { customer, customerContact } from './customer'
import { consignment, lot } from './consignment'
import { acceptanceRecord } from './acceptance'
import { storeSection } from './warehouse'
import { storedFile } from './files'

/**
 * M17 — Dispatch, Loading & Gate-Out Control.
 *
 * The last control in the chain, and the one with the most expensive failure mode: coffee
 * that leaves the gate cannot be un-left.
 *
 * Clearance is therefore checked at the moment of gate-out, not at release-request time. A
 * dispatch order approved on Monday against an acceptance that was disputed on Tuesday must
 * not pass on Wednesday. The check lives in the domain (`clearance.ts`) and is re-run here.
 */

/** Vehicles seen often enough to be worth remembering. */
export const vehicle = pgTable(
  'vehicle',
  {
    id: uuid('id').primaryKey(),
    plateNo: text('plate_no').notNull(),
    /** TRUCK | ISUZU | PICKUP | TRAILER */
    vehicleType: text('vehicle_type'),
    capacityKg: weightKg('capacity_kg'),
    ownerName: text('owner_name'),
    transporterName: text('transporter_name'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_vehicle__plate').on(t.plateNo)],
)

/**
 * The customer's request to take coffee out.
 *
 * `authorisedByContactId` points at a contact carrying `can_authorise_release`. That link is
 * the reason a release cannot be talked through over the phone by whoever answers.
 */
export const releaseRequest = pgTable(
  'release_request',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    consignmentId: uuid('consignment_id').references(() => consignment.id),

    /** DRAFT → SUBMITTED → APPROVED | REJECTED → DISPATCHED | CANCELLED */
    status: text('status').notNull().default('DRAFT'),

    requestedQuantityKg: weightKg('requested_quantity_kg').notNull(),
    requestedKeshaCount: keshaCount('requested_kesha_count'),
    requestedCollectionOn: calendarDate('requested_collection_on'),

    /** The contact who authorised it — must hold can_authorise_release. */
    authorisedByContactId: uuid('authorised_by_contact_id').references(
      () => customerContact.id,
    ),
    authorisationLetterFileId: uuid('authorisation_letter_file_id').references(
      () => storedFile.id,
    ),

    collectorName: text('collector_name'),
    collectorIdNo: text('collector_id_no'),
    collectorPhone: text('collector_phone'),
    vehiclePlate: text('vehicle_plate'),

    submittedAt: instant('submitted_at'),
    approvedBy: uuid('approved_by'),
    approvedAt: instant('approved_at'),
    rejectionReason: text('rejection_reason'),
    cancelledAt: instant('cancelled_at'),
    cancelledReason: text('cancelled_reason'),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_release_request__reference').on(t.reference),
    index('idx_release_request__customer').on(t.customerId, t.createdAt),
    index('idx_release_request__consignment').on(t.consignmentId),
    index('idx_release_request__status').on(t.status),
    index('idx_release_request__pending')
      .on(t.requestedCollectionOn)
      .where(sql`${t.status} = 'SUBMITTED'`),
    check(
      'ck_release_request__status',
      sql`${t.status} in ('DRAFT','SUBMITTED','APPROVED','REJECTED','DISPATCHED','CANCELLED')`,
    ),
    check('ck_release_request__quantity', sql`${t.requestedQuantityKg} > 0`),
  ],
)

/**
 * The dispatch order — the loading instruction, and the record the gate checks.
 *
 * `clearanceStatus` is recomputed and stored at gate-out. Storing the verdict alongside the
 * time it was reached is what makes "why was this allowed out?" answerable later.
 */
export const dispatchOrder = pgTable(
  'dispatch_order',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    consignmentId: uuid('consignment_id').references(() => consignment.id),
    releaseRequestId: uuid('release_request_id').references(() => releaseRequest.id),
    acceptanceId: uuid('acceptance_id').references(() => acceptanceRecord.id),

    /** PLANNED → LOADING → LOADED → GATE_CLEARED → DISPATCHED | CANCELLED */
    status: text('status').notNull().default('PLANNED'),

    plannedQuantityKg: weightKg('planned_quantity_kg').notNull(),
    plannedKeshaCount: keshaCount('planned_kesha_count'),
    loadedQuantityKg: weightKg('loaded_quantity_kg'),
    loadedKeshaCount: keshaCount('loaded_kesha_count'),

    vehicleId: uuid('vehicle_id').references(() => vehicle.id),
    vehiclePlate: text('vehicle_plate'),
    trailerPlate: text('trailer_plate'),
    driverName: text('driver_name'),
    driverIdNo: text('driver_id_no'),
    driverPhone: text('driver_phone'),
    transporterName: text('transporter_name'),
    destination: text('destination'),

    /** CLEARED | BLOCKED — the verdict, frozen at the moment it was reached. */
    clearanceStatus: text('clearance_status'),
    clearanceCheckedAt: instant('clearance_checked_at'),
    clearanceCheckedBy: uuid('clearance_checked_by'),
    /** Why it was blocked, or which override let it through. */
    clearanceNote: text('clearance_note'),
    overrideApprovedBy: uuid('override_approved_by'),
    overrideReason: text('override_reason'),

    loadingStartedAt: instant('loading_started_at'),
    loadingCompletedAt: instant('loading_completed_at'),
    gateOutAt: instant('gate_out_at'),
    dispatchedAt: instant('dispatched_at'),
    cancelledAt: instant('cancelled_at'),
    cancelledReason: text('cancelled_reason'),

    /** The delivery note handed to the driver. */
    deliveryNoteFileId: uuid('delivery_note_file_id').references(() => storedFile.id),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_dispatch_order__reference').on(t.reference),
    index('idx_dispatch_order__customer').on(t.customerId, t.createdAt),
    index('idx_dispatch_order__consignment').on(t.consignmentId),
    index('idx_dispatch_order__status').on(t.status),
    index('idx_dispatch_order__release').on(t.releaseRequestId),
    index('idx_dispatch_order__gate_queue')
      .on(t.loadingCompletedAt)
      .where(sql`${t.status} in ('LOADED','GATE_CLEARED')`),
    check(
      'ck_dispatch_order__status',
      sql`${t.status} in ('PLANNED','LOADING','LOADED','GATE_CLEARED','DISPATCHED','CANCELLED')`,
    ),
    check(
      'ck_dispatch_order__clearance',
      sql`${t.clearanceStatus} is null or ${t.clearanceStatus} in ('CLEARED','BLOCKED')`,
    ),
    check('ck_dispatch_order__planned', sql`${t.plannedQuantityKg} > 0`),
    // Nothing is dispatched without a recorded clearance verdict. This is the control that
    // makes the gate meaningful, and it belongs in the database rather than in one screen.
    check(
      'ck_dispatch_order__dispatched_is_cleared',
      sql`${t.status} not in ('GATE_CLEARED','DISPATCHED') or ${t.clearanceStatus} = 'CLEARED'`,
    ),
    // A BLOCKED order that went out anyway must name who overrode it.
    check(
      'ck_dispatch_order__override_named',
      sql`${t.overrideReason} is null or ${t.overrideApprovedBy} is not null`,
    ),
  ],
)

/** What actually went on the truck, lot by lot. Drives the ledger issue. */
export const dispatchLine = pgTable(
  'dispatch_line',
  {
    id: uuid('id').primaryKey(),
    dispatchOrderId: uuid('dispatch_order_id')
      .notNull()
      .references(() => dispatchOrder.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => lot.id),
    locationId: uuid('location_id').references(() => storeSection.id),
    bagTypeId: uuid('bag_type_id').references(() => bagType.id),
    quantityKg: weightKg('quantity_kg').notNull(),
    keshaCount: keshaCount('kesha_count').notNull(),
    stockMovementId: uuid('stock_movement_id'),
    loadedAt: instant('loaded_at'),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_dispatch_line__no').on(t.dispatchOrderId, t.lineNo),
    index('idx_dispatch_line__order').on(t.dispatchOrderId),
    index('idx_dispatch_line__lot').on(t.lotId),
    check('ck_dispatch_line__quantity', sql`${t.quantityKg} > 0`),
    check('ck_dispatch_line__kesha', sql`${t.keshaCount} > 0`),
  ],
)

/** Append-only status trail for a dispatch order. */
export const dispatchStatusHistory = pgTable(
  'dispatch_status_history',
  {
    id: uuid('id').primaryKey(),
    dispatchOrderId: uuid('dispatch_order_id')
      .notNull()
      .references(() => dispatchOrder.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    note: text('note'),
    changedAt: instant('changed_at')
      .notNull()
      .default(sql`now()`),
    changedBy: uuid('changed_by'),
  },
  (t) => [index('idx_dispatch_status_history__order').on(t.dispatchOrderId, t.changedAt)],
)

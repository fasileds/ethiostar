import {
  pgTable,
  text,
  uuid,
  index,
  uniqueIndex,
  check,
  integer,
  boolean,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  activeFlag,
  displayNames,
  weightKg,
  keshaCount,
  percent,
  instant,
} from '../helpers/columns'
import { branch } from './master-data'

/**
 * M12 — Warehouse, Room & Section Management.
 *
 * Three levels: warehouse → room → section. Capacity is expressed in BOTH units at every
 * level, because a room can run out of floor space for bags while still having weight
 * headroom, and refusing on the wrong axis produces a confusing message.
 *
 * The M12 key control — "Every kilogram in the system must be at a defined location;
 * unallocated stock is not permitted" — is enforced by `stock_movement.location_id NOT NULL`
 * (Step 16), not here. This module defines the locations that constraint points at.
 */

export const warehouse = pgTable(
  'warehouse',
  {
    id: uuid('id').primaryKey(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    code: text('code').notNull(),
    ...displayNames(),
    description: text('description'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_warehouse__code').on(t.code),
    index('idx_warehouse__branch').on(t.branchId),
  ],
)

export const storeRoom = pgTable(
  'store_room',
  {
    id: uuid('id').primaryKey(),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouse.id),
    code: text('code').notNull(),
    ...displayNames(),
    description: text('description'),
    lengthM: percent('length_m'),
    widthM: percent('width_m'),
    heightM: percent('height_m'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_store_room__code').on(t.code),
    index('idx_store_room__warehouse').on(t.warehouseId),
  ],
)

/**
 * The lowest level, and the only one stock is actually placed into.
 *
 * `isLossAccount` marks a virtual section per warehouse that receives PROCESS_LOSS
 * movements. Loss is a destination in the ledger, not a second withdrawal — routing it to a
 * real location keeps "every kilogram is at a defined location" true even for the kilograms
 * that became dust and chaff. See docs/architecture/03-domain-model.md §3.4.
 */
export const storeSection = pgTable(
  'store_section',
  {
    id: uuid('id').primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => storeRoom.id),
    code: text('code').notNull(),
    ...displayNames(),
    capacityKg: weightKg('capacity_kg').notNull(),
    capacityKesha: keshaCount('capacity_kesha').notNull(),
    /** Fraction of physical capacity that may be used, e.g. 0.900. */
    safeFillPct: percent('safe_fill_pct').notNull().default('0.900'),
    /** Virtual section receiving process loss; never physically occupied. */
    isLossAccount: boolean('is_loss_account').notNull().default(false),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_store_section__code').on(t.code),
    index('idx_store_section__room').on(t.roomId),
    check('ck_store_section__capacity_kg', sql`${t.capacityKg} >= 0`),
    check('ck_store_section__capacity_kesha', sql`${t.capacityKesha} >= 0`),
    check('ck_store_section__safe_fill', sql`${t.safeFillPct} > 0 and ${t.safeFillPct} <= 1`),
  ],
)

/**
 * A capacity reservation — what makes the pre-arrival check honest.
 *
 * Created when a delivery request is APPROVED, consumed when the goods receipt is placed,
 * expired by a worker job. Without reservations, ten requests approved on Monday all "fit"
 * and none of them do on Friday.
 */
export const capacityReservation = pgTable(
  'capacity_reservation',
  {
    id: uuid('id').primaryKey(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => storeSection.id),
    /** FK added by the inbound migration (Step 17) to avoid a forward reference here. */
    deliveryRequestId: uuid('delivery_request_id').notNull(),
    customerId: uuid('customer_id').notNull(),
    quantityKg: weightKg('quantity_kg').notNull(),
    keshaCount: keshaCount('kesha_count').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    expiresAt: instant('expires_at').notNull(),
    consumedAt: instant('consumed_at'),
    releasedAt: instant('released_at'),
    releasedReason: text('released_reason'),
    ...auditColumns(),
  },
  (t) => [
    // Partial index: the active set stays small while the table grows without bound, so
    // the capacity query — which runs on every availability check — stays cheap.
    index('idx_capacity_reservation__active')
      .on(t.locationId)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('idx_capacity_reservation__request').on(t.deliveryRequestId),
    index('idx_capacity_reservation__expiring')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'ACTIVE'`),
    check(
      'ck_capacity_reservation__status',
      sql`${t.status} in ('ACTIVE','CONSUMED','EXPIRED','RELEASED')`,
    ),
    check('ck_capacity_reservation__quantity', sql`${t.quantityKg} > 0`),
  ],
)

/** Per-location alert thresholds, overriding the system default. */
export const locationAlertThreshold = pgTable(
  'location_alert_threshold',
  {
    id: uuid('id').primaryKey(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => storeSection.id, { onDelete: 'cascade' }),
    /** Occupancy percentage at which the alert fires. */
    thresholdPct: percent('threshold_pct').notNull(),
    /** WARNING | CRITICAL */
    severity: text('severity').notNull().default('WARNING'),
    notifyRoleCode: text('notify_role_code'),
    /** Suppresses repeat alerts while occupancy stays above the threshold. */
    lastFiredAt: instant('last_fired_at'),
    cooldownHours: integer('cooldown_hours').notNull().default(24),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_location_alert_threshold__pair').on(t.locationId, t.thresholdPct),
    check(
      'ck_location_alert_threshold__severity',
      sql`${t.severity} in ('WARNING','CRITICAL')`,
    ),
  ],
)

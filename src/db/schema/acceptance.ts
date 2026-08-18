import { pgTable, text, uuid, index, uniqueIndex, check, integer } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  weightKg,
  keshaCount,
  percent,
  instant,
  occurrenceColumns,
} from '../helpers/columns'
import { branch, outputClassification } from './master-data'
import { customer } from './customer'
import { consignment, lot } from './consignment'
import { jobOrder } from './processing'
import { storedFile } from './files'

/**
 * M16 — Mirt Merekebiya (Customer Output Acceptance).
 *
 * The commercial hinge of the whole system. Until the customer signs, processed output is
 * EthioStar's problem; after they sign, the quantities are agreed and dispatch may proceed.
 *
 * Two rules make this record worth having:
 *
 *  1. It is IMMUTABLE once signed. A signed acceptance that can be edited is not evidence.
 *     Corrections go through a new, linked record that references what it supersedes.
 *  2. Disputes are first-class. "Customer disagrees with the reject percentage" is an
 *     expected outcome, not an error state, and the coffee must not move while it is open.
 */

export const acceptanceRecord = pgTable(
  'acceptance_record',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    consignmentId: uuid('consignment_id')
      .notNull()
      .references(() => consignment.id),
    jobOrderId: uuid('job_order_id').references(() => jobOrder.id),

    /** DRAFT → PRESENTED → ACCEPTED | DISPUTED | PARTIALLY_ACCEPTED → CLOSED | CANCELLED */
    status: text('status').notNull().default('DRAFT'),

    /** What EthioStar presented. */
    presentedQuantityKg: weightKg('presented_quantity_kg').notNull(),
    presentedKeshaCount: keshaCount('presented_kesha_count'),
    /** What the customer actually accepted — may be less. */
    acceptedQuantityKg: weightKg('accepted_quantity_kg'),
    acceptedKeshaCount: keshaCount('accepted_kesha_count'),
    disputedQuantityKg: weightKg('disputed_quantity_kg'),

    yieldPct: percent('yield_pct'),
    lossPct: percent('loss_pct'),

    presentedAt: instant('presented_at'),
    presentedBy: uuid('presented_by'),

    /** Who signed, on the customer's side. */
    customerRepName: text('customer_rep_name'),
    customerRepIdNo: text('customer_rep_id_no'),
    customerContactId: uuid('customer_contact_id'),
    signedAt: instant('signed_at'),
    signatureFileId: uuid('signature_file_id').references(() => storedFile.id),
    /** Witness on EthioStar's side — the second name on the paper form. */
    witnessName: text('witness_name'),
    witnessUserId: uuid('witness_user_id'),

    disputeReason: text('dispute_reason'),
    disputeRaisedAt: instant('dispute_raised_at'),
    disputeResolvedAt: instant('dispute_resolved_at'),
    disputeResolution: text('dispute_resolution'),
    disputeResolvedBy: uuid('dispute_resolved_by'),

    /** A correction supersedes an earlier record rather than editing it. */
    supersedesId: uuid('supersedes_id'),
    supersededReason: text('superseded_reason'),

    closedAt: instant('closed_at'),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_acceptance_record__reference').on(t.reference),
    index('idx_acceptance_record__consignment').on(t.consignmentId),
    index('idx_acceptance_record__customer').on(t.customerId, t.createdAt),
    index('idx_acceptance_record__job').on(t.jobOrderId),
    index('idx_acceptance_record__status').on(t.status),
    // The queue the dashboard counts.
    index('idx_acceptance_record__awaiting')
      .on(t.presentedAt)
      .where(sql`${t.status} = 'PRESENTED'`),
    check(
      'ck_acceptance_record__status',
      sql`${t.status} in ('DRAFT','PRESENTED','ACCEPTED','PARTIALLY_ACCEPTED','DISPUTED','CLOSED','CANCELLED')`,
    ),
    check('ck_acceptance_record__presented_qty', sql`${t.presentedQuantityKg} > 0`),
    check(
      'ck_acceptance_record__accepted_within_presented',
      sql`${t.acceptedQuantityKg} is null or ${t.acceptedQuantityKg} <= ${t.presentedQuantityKg}`,
    ),
    // An accepted record must carry a signature and a name. Without both it is not evidence
    // of anything, and the dispatch clearance check depends on it being evidence.
    check(
      'ck_acceptance_record__accepted_is_signed',
      sql`${t.status} not in ('ACCEPTED','PARTIALLY_ACCEPTED') or (${t.signedAt} is not null and ${t.customerRepName} is not null)`,
    ),
    check(
      'ck_acceptance_record__disputed_has_reason',
      sql`${t.status} <> 'DISPUTED' or ${t.disputeReason} is not null`,
    ),
  ],
)

/**
 * The line detail — what was accepted, by output class.
 *
 * A customer accepts the primary grade and disputes the rejects. One aggregate number cannot
 * represent that, and the dispatch clearance needs to know exactly which lots are free to move.
 */
export const acceptanceLine = pgTable(
  'acceptance_line',
  {
    id: uuid('id').primaryKey(),
    acceptanceId: uuid('acceptance_id')
      .notNull()
      .references(() => acceptanceRecord.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    lotId: uuid('lot_id').references(() => lot.id),
    classificationId: uuid('classification_id').references(() => outputClassification.id),

    presentedQuantityKg: weightKg('presented_quantity_kg').notNull(),
    presentedKeshaCount: keshaCount('presented_kesha_count'),
    acceptedQuantityKg: weightKg('accepted_quantity_kg'),
    acceptedKeshaCount: keshaCount('accepted_kesha_count'),

    /** ACCEPTED | REJECTED | DISPUTED */
    lineVerdict: text('line_verdict').notNull().default('ACCEPTED'),
    remark: text('remark'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_acceptance_line__no').on(t.acceptanceId, t.lineNo),
    index('idx_acceptance_line__acceptance').on(t.acceptanceId),
    index('idx_acceptance_line__lot').on(t.lotId),
    check(
      'ck_acceptance_line__verdict',
      sql`${t.lineVerdict} in ('ACCEPTED','REJECTED','DISPUTED')`,
    ),
    check('ck_acceptance_line__presented', sql`${t.presentedQuantityKg} >= 0`),
  ],
)

/** Append-only trail. An acceptance's history is the evidence, so nothing here is editable. */
export const acceptanceStatusHistory = pgTable(
  'acceptance_status_history',
  {
    id: uuid('id').primaryKey(),
    acceptanceId: uuid('acceptance_id')
      .notNull()
      .references(() => acceptanceRecord.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    note: text('note'),
    ...occurrenceColumns(),
    changedBy: uuid('changed_by'),
  },
  (t) => [index('idx_acceptance_status_history__acceptance').on(t.acceptanceId, t.occurredAt)],
)

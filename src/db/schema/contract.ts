import { pgTable, text, uuid, index, uniqueIndex, check } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  effectivePeriod,
  moneyAmount,
  currency,
  keshaCount,
  instant,
} from '../helpers/columns'
import { branch } from './master-data'
import { customer } from './customer'
import { storedFile } from './files'

/**
 * M10 — Contract, Tariff & Service Agreement Management.
 *
 * "Holds the commercial terms agreed with each customer, so that every charge raised later
 * is traceable to a signed agreement rather than to a verbal understanding." The M02 pattern
 * — effective-dated versioning, EXCLUDE-constrained in a migration — applies here exactly as
 * it does to bag types: a tariff line's overlap is a database guarantee, not a hopeful check.
 */

export const contract = pgTable(
  'contract',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    /** DRAFT → ACTIVE → EXPIRED | TERMINATED */
    status: text('status').notNull().default('DRAFT'),
    ...effectivePeriod(),
    /** Days of storage included before M20 charging begins. */
    freeStorageDays: keshaCount('free_storage_days').notNull().default(0),
    paymentTermsDays: keshaCount('payment_terms_days').notNull().default(30),
    creditLimitAmount: moneyAmount('credit_limit_amount'),
    currency: currency(),
    signedDocumentFileId: uuid('signed_document_file_id').references(() => storedFile.id),
    terminatedAt: instant('terminated_at'),
    terminatedReason: text('terminated_reason'),
    notes: text('notes'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_contract__reference').on(t.reference),
    index('idx_contract__customer').on(t.customerId, t.effectiveFrom),
    index('idx_contract__status').on(t.status),
    check('ck_contract__status', sql`${t.status} in ('DRAFT','ACTIVE','EXPIRED','TERMINATED')`),
    check(
      'ck_contract__period',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
  ],
)

/**
 * One priced service line. `contractId` null means this is part of the BRANCH STANDARD
 * tariff (M10 §5: "standard tariff by default, with negotiated rates … where agreed") rather
 * than a customer-specific negotiated rate — `resolveTariffRate` (application layer) checks
 * the customer's active contract first and falls back to the standard line for the branch.
 *
 * `serviceCode` keys the same billable events M19 raises charges for: UNLOADING, LOADING,
 * STORAGE_PER_DAY, PROCESSING_PER_KG, BAGGING, REBAGGING, SPECIAL_HANDLING.
 */
export const tariffLine = pgTable(
  'tariff_line',
  {
    id: uuid('id').primaryKey(),
    contractId: uuid('contract_id').references(() => contract.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    serviceCode: text('service_code').notNull(),
    /** PER_KG | PER_KESHA | PER_DAY | FLAT */
    uom: text('uom').notNull(),
    rateAmount: moneyAmount('rate_amount').notNull(),
    currency: currency(),
    ...effectivePeriod(),
    /** A negotiated line requires a stated reason (M10 §5: "any override requires approval
     *  and a reason") — null on the standard tariff, required whenever contractId is set. */
    negotiationReason: text('negotiation_reason'),
    ...auditColumns(),
  },
  (t) => [
    index('idx_tariff_line__contract').on(t.contractId, t.serviceCode),
    index('idx_tariff_line__standard').on(t.branchId, t.serviceCode, t.effectiveFrom),
    check('ck_tariff_line__uom', sql`${t.uom} in ('PER_KG','PER_KESHA','PER_DAY','FLAT')`),
    check('ck_tariff_line__rate', sql`${t.rateAmount} >= 0`),
    check(
      'ck_tariff_line__period',
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    check(
      'ck_tariff_line__negotiation_reason',
      sql`${t.contractId} is null or ${t.negotiationReason} is not null`,
    ),
  ],
)

import { pgTable, text, uuid, index, uniqueIndex, check, boolean } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  appendOnlyColumns,
  moneyAmount,
  currency,
  weightKg,
  keshaCount,
  instant,
  calendarDate,
  sourceReference,
} from '../helpers/columns'
import { branch } from './master-data'
import { customer } from './customer'
import { contract } from './contract'

/**
 * M19 Billing, Invoicing & Receivables + M20 Storage & Demurrage Charging.
 *
 * ONE RULE MAKES THE WHOLE MODULE TRUSTWORTHY: "every charge line traces back to a specific
 * operational transaction; no manual charge exists without a reference and a reason." That is
 * `charge_event` — an append-only ledger raised at the moment a billable operation is
 * recorded (or, for storage, by the nightly dwell-time job), independent of whether or when
 * it gets swept into an invoice. `invoice_line.charge_event_id` is how "what did EthioStar
 * bill me for THIS goods receipt" stays answerable months later.
 */

/**
 * A billable fact, priced at the moment it is raised (M10's resolved tariff rate is copied in,
 * not re-looked-up later — the M02 key control: a later tariff change must not retroactively
 * alter a charge already raised).
 */
export const chargeEvent = pgTable(
  'charge_event',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    contractId: uuid('contract_id').references(() => contract.id),
    /** UNLOADING | LOADING | STORAGE_PER_DAY | PROCESSING_PER_KG | BAGGING | REBAGGING |
     *  SPECIAL_HANDLING */
    serviceCode: text('service_code').notNull(),
    /** The operational record this charge is FOR — a goods receipt, a job order, a lot's
     *  storage-day span. */
    ...sourceReference(),
    quantity: weightKg('quantity'),
    keshaQuantity: keshaCount('kesha_quantity'),
    /** PER_KG | PER_KESHA | PER_DAY | FLAT — copied from the tariff line that priced this. */
    uom: text('uom').notNull(),
    rateAmount: moneyAmount('rate_amount').notNull(),
    amount: moneyAmount('amount').notNull(),
    currency: currency(),
    occurredAt: instant('occurred_at').notNull(),
    /** Set once this event is swept into an invoice line — never cleared, never reused. */
    invoiceLineId: uuid('invoice_line_id'),
    ...appendOnlyColumns(),
  },
  (t) => [
    index('idx_charge_event__customer').on(t.customerId, t.occurredAt),
    index('idx_charge_event__source').on(t.sourceType, t.sourceId),
    index('idx_charge_event__uninvoiced')
      .on(t.customerId, t.occurredAt)
      .where(sql`${t.invoiceLineId} is null`),
    check('ck_charge_event__amount', sql`${t.amount} >= 0`),
    check('ck_charge_event__uom', sql`${t.uom} in ('PER_KG','PER_KESHA','PER_DAY','FLAT')`),
  ],
)

export const invoice = pgTable(
  'invoice',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    contractId: uuid('contract_id').references(() => contract.id),
    /** DRAFT → ISSUED → PARTIALLY_PAID | PAID | OVERDUE | VOID */
    status: text('status').notNull().default('DRAFT'),
    issueDate: calendarDate('issue_date').notNull(),
    dueDate: calendarDate('due_date').notNull(),
    subtotalAmount: moneyAmount('subtotal_amount').notNull().default('0'),
    taxAmount: moneyAmount('tax_amount').notNull().default('0'),
    totalAmount: moneyAmount('total_amount').notNull().default('0'),
    paidAmount: moneyAmount('paid_amount').notNull().default('0'),
    currency: currency(),
    notes: text('notes'),
    voidedAt: instant('voided_at'),
    voidedReason: text('voided_reason'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_invoice__reference').on(t.reference),
    index('idx_invoice__customer').on(t.customerId, t.issueDate),
    index('idx_invoice__status').on(t.status, t.dueDate),
    check(
      'ck_invoice__status',
      sql`${t.status} in ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','OVERDUE','VOID')`,
    ),
    check('ck_invoice__totals', sql`${t.totalAmount} = ${t.subtotalAmount} + ${t.taxAmount}`),
  ],
)

export const invoiceLine = pgTable(
  'invoice_line',
  {
    id: uuid('id').primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoice.id, { onDelete: 'cascade' }),
    chargeEventId: uuid('charge_event_id').references(() => chargeEvent.id),
    lineNo: keshaCount('line_no').notNull(),
    description: text('description').notNull(),
    serviceCode: text('service_code').notNull(),
    quantity: weightKg('quantity'),
    uom: text('uom').notNull(),
    rateAmount: moneyAmount('rate_amount').notNull(),
    lineAmount: moneyAmount('line_amount').notNull(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_invoice_line__no').on(t.invoiceId, t.lineNo),
    index('idx_invoice_line__charge_event').on(t.chargeEventId),
  ],
)

export const payment = pgTable(
  'payment',
  {
    id: uuid('id').primaryKey(),
    reference: text('reference').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    /** Null while the payment sits on account, unallocated to a specific invoice. */
    invoiceId: uuid('invoice_id').references(() => invoice.id),
    amount: moneyAmount('amount').notNull(),
    currency: currency(),
    /** CASH | BANK_TRANSFER | CHEQUE | MOBILE_MONEY */
    method: text('method').notNull(),
    externalReference: text('external_reference'),
    receivedAt: instant('received_at').notNull(),
    recordedBy: uuid('recorded_by').notNull(),
    voidedAt: instant('voided_at'),
    voidedReason: text('voided_reason'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_payment__reference').on(t.reference),
    index('idx_payment__customer').on(t.customerId, t.receivedAt),
    index('idx_payment__invoice').on(t.invoiceId),
    check('ck_payment__amount', sql`${t.amount} > 0`),
    check(
      'ck_payment__method',
      sql`${t.method} in ('CASH','BANK_TRANSFER','CHEQUE','MOBILE_MONEY')`,
    ),
  ],
)

/**
 * The REAL financial hold M19 adds (docs/phase-1/scope.md B3: Phase 1 shipped only the
 * document-compliance and manual holds behind `CustomerHoldPolicy`; this is the second
 * policy). A customer beyond credit terms is flagged here, and M14/M17 now check it before
 * scheduling or gate-out.
 */
export const customerCreditHold = pgTable(
  'customer_credit_hold',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    /** OVERDUE_BALANCE | CREDIT_LIMIT_EXCEEDED | MANUAL */
    reason: text('reason').notNull(),
    note: text('note'),
    isAutomatic: boolean('is_automatic').notNull().default(false),
    heldBy: uuid('held_by'),
    heldAt: instant('held_at')
      .notNull()
      .default(sql`now()`),
    releasedBy: uuid('released_by'),
    releasedAt: instant('released_at'),
  },
  (t) => [
    index('idx_customer_credit_hold__customer')
      .on(t.customerId)
      .where(sql`${t.releasedAt} is null`),
    check(
      'ck_customer_credit_hold__reason',
      sql`${t.reason} in ('OVERDUE_BALANCE','CREDIT_LIMIT_EXCEEDED','MANUAL')`,
    ),
  ],
)

/**
 * M20 storage/demurrage — one row per priced dwell-time span for a lot, feeding a
 * `charge_event` (serviceCode STORAGE_PER_DAY) exactly like any other billable event.
 */
export const storageRateTier = pgTable(
  'storage_rate_tier',
  {
    id: uuid('id').primaryKey(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),
    /** This tier applies from day N of dwell time onward — a higher rate after a threshold
     *  "to encourage timely collection of long-standing stock" (M20 §5). */
    fromDay: keshaCount('from_day').notNull(),
    ratePerKgPerDay: moneyAmount('rate_per_kg_per_day').notNull(),
    currency: currency(),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [
    index('idx_storage_rate_tier__branch').on(t.branchId, t.fromDay),
    check('ck_storage_rate_tier__from_day', sql`${t.fromDay} >= 0`),
    check('ck_storage_rate_tier__rate', sql`${t.ratePerKgPerDay} >= 0`),
  ],
)

export const storageCharge = pgTable(
  'storage_charge',
  {
    id: uuid('id').primaryKey(),
    lotId: uuid('lot_id').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id),
    fromDate: calendarDate('from_date').notNull(),
    toDate: calendarDate('to_date').notNull(),
    daysCharged: keshaCount('days_charged').notNull(),
    quantityKg: weightKg('quantity_kg').notNull(),
    ratePerKgPerDay: moneyAmount('rate_per_kg_per_day').notNull(),
    amount: moneyAmount('amount').notNull(),
    chargeEventId: uuid('charge_event_id').references(() => chargeEvent.id),
    ...appendOnlyColumns(),
  },
  (t) => [
    index('idx_storage_charge__lot').on(t.lotId, t.toDate),
    index('idx_storage_charge__customer').on(t.customerId, t.toDate),
    // A lot's dwell time is a continuous, non-overlapping span — the same day must never be
    // billed twice, which is the M20 equivalent of "a gap is a question with no good answer".
    uniqueIndex('uq_storage_charge__lot_span').on(t.lotId, t.fromDate, t.toDate),
    check('ck_storage_charge__span', sql`${t.toDate} >= ${t.fromDate}`),
    check('ck_storage_charge__amount', sql`${t.amount} >= 0`),
  ],
)

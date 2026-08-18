import { pgTable, text, uuid, index, uniqueIndex, check, boolean } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { auditColumns, activeFlag, instant, calendarDate } from '../helpers/columns'
import { branch, region, woreda } from './master-data'
import { businessType } from './reference'

/**
 * M07 — Customer Master.
 *
 * A customer exists only after an application is approved (M08). That is why `customer` has
 * no self-service create path: the row is written by the approval use case, in the same
 * transaction that closes the application, so an approved application without a customer —
 * or a customer nobody approved — cannot exist.
 *
 * Contacts, addresses and bank accounts are separate tables rather than columns because a
 * cooperative union has several delegates, several sites and more than one account, and
 * flattening them means losing the one that mattered at dispute time.
 */

export const customer = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey(),
    /** Human-quotable, printed on every document. Generated CUS-YYYY-NNNNN. */
    code: text('code').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),

    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    legalNameAm: text('legal_name_am'),

    businessTypeId: uuid('business_type_id').references(() => businessType.id),
    /** Ethiopian TIN. Unique when present — two customers cannot share one. */
    tin: text('tin'),
    businessLicenceNo: text('business_licence_no'),
    licenceExpiresOn: calendarDate('licence_expires_on'),
    /** ECX membership, where the customer trades through the exchange. */
    ecxMembershipNo: text('ecx_membership_no'),

    regionId: uuid('region_id').references(() => region.id),
    woredaId: uuid('woreda_id').references(() => woreda.id),

    primaryPhone: text('primary_phone'),
    primaryEmail: text('primary_email'),

    /** ACTIVE | SUSPENDED | CLOSED — suspension blocks new delivery requests, not withdrawal. */
    status: text('status').notNull().default('ACTIVE'),
    suspendedReason: text('suspended_reason'),
    suspendedAt: instant('suspended_at'),

    /** The application this customer was created from. Never null in practice. */
    applicationId: uuid('application_id'),

    onboardedOn: calendarDate('onboarded_on'),
    notes: text('notes'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_customer__code').on(t.code),
    // Partial unique: many customers legitimately have no TIN recorded yet, but no two may
    // share one. A plain unique index would collapse every NULL into a conflict on some
    // engines and permit unlimited duplicates on others — be explicit.
    uniqueIndex('uq_customer__tin')
      .on(t.tin)
      .where(sql`${t.tin} is not null`),
    index('idx_customer__branch').on(t.branchId),
    index('idx_customer__status').on(t.status),
    index('idx_customer__legal_name').on(t.legalName),
    check('ck_customer__status', sql`${t.status} in ('ACTIVE','SUSPENDED','CLOSED')`),
  ],
)

/**
 * A person EthioStar actually speaks to.
 *
 * `canAuthoriseRelease` is a commercial control, not a UI preference: only a contact carrying
 * it may sign a release request, which is what stops a driver from collecting someone else's
 * coffee with a plausible phone call.
 */
export const customerContact = pgTable(
  'customer_contact',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    position: text('position'),
    phone: text('phone'),
    email: text('email'),
    isPrimary: boolean('is_primary').notNull().default(false),
    canAuthoriseRelease: boolean('can_authorise_release').notNull().default(false),
    idDocumentType: text('id_document_type'),
    idDocumentNo: text('id_document_no'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    index('idx_customer_contact__customer').on(t.customerId),
    // At most one primary contact per customer, enforced by the database rather than by
    // whichever screen happens to be saving.
    uniqueIndex('uq_customer_contact__primary')
      .on(t.customerId)
      .where(sql`${t.isPrimary} and ${t.isActive}`),
  ],
)

export const customerAddress = pgTable(
  'customer_address',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    /** HEAD_OFFICE | SITE | BILLING */
    addressType: text('address_type').notNull().default('HEAD_OFFICE'),
    regionId: uuid('region_id').references(() => region.id),
    woredaId: uuid('woreda_id').references(() => woreda.id),
    city: text('city'),
    subCity: text('sub_city'),
    kebele: text('kebele'),
    houseNo: text('house_no'),
    poBox: text('po_box'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    index('idx_customer_address__customer').on(t.customerId),
    check(
      'ck_customer_address__type',
      sql`${t.addressType} in ('HEAD_OFFICE','SITE','BILLING')`,
    ),
  ],
)

/**
 * Bank details.
 *
 * Phase 1 records them; M19/M20 (Phase 2) pays against them. Captured now because they are
 * collected during onboarding anyway, and re-asking a customer for details they already gave
 * is the kind of friction that makes an operator keep a spreadsheet instead.
 */
export const customerBankAccount = pgTable(
  'customer_bank_account',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    bankName: text('bank_name').notNull(),
    branchName: text('branch_name'),
    accountName: text('account_name').notNull(),
    accountNumber: text('account_number').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    index('idx_customer_bank_account__customer').on(t.customerId),
    uniqueIndex('uq_customer_bank_account__primary')
      .on(t.customerId)
      .where(sql`${t.isPrimary} and ${t.isActive}`),
  ],
)

/** Every status change, append-only. "Who suspended this customer, when, and why." */
export const customerStatusHistory = pgTable(
  'customer_status_history',
  {
    id: uuid('id').primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason'),
    changedAt: instant('changed_at')
      .notNull()
      .default(sql`now()`),
    changedBy: uuid('changed_by'),
  },
  (t) => [index('idx_customer_status_history__customer').on(t.customerId, t.changedAt)],
)

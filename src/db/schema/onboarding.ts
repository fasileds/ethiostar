import { pgTable, text, uuid, index, uniqueIndex, check, boolean } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { auditColumns, instant, calendarDate, weightKg, keshaCount } from '../helpers/columns'
import { branch, region, woreda, coffeeType } from './master-data'
import { businessType, kycDocumentType } from './reference'
import { customer } from './customer'
import { storedFile } from './files'

/**
 * M08 — Customer Onboarding & Application.
 *
 * The public entry point. An application is submitted by someone who is NOT yet a user of
 * the system, which drives two decisions:
 *
 *  1. `reference` is the only credential. A public applicant tracks progress by reference
 *     alone, so it is a high-entropy string, not a sequence — a guessable reference leaks
 *     one applicant's TIN and licence to another.
 *  2. The row is written by an anonymous, rate-limited path. Everything a staff member later
 *     relies on is re-validated at review; nothing trusts the submitted values.
 *
 * On approval the application becomes a `customer` in one transaction (see M07).
 */

export const customerApplication = pgTable(
  'customer_application',
  {
    id: uuid('id').primaryKey(),
    /** Quoted by the applicant to track status. High-entropy, not sequential. */
    reference: text('reference').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id),

    legalName: text('legal_name').notNull(),
    tradeName: text('trade_name'),
    legalNameAm: text('legal_name_am'),
    businessTypeId: uuid('business_type_id').references(() => businessType.id),
    tin: text('tin'),
    businessLicenceNo: text('business_licence_no'),
    licenceExpiresOn: calendarDate('licence_expires_on'),
    ecxMembershipNo: text('ecx_membership_no'),

    regionId: uuid('region_id').references(() => region.id),
    woredaId: uuid('woreda_id').references(() => woreda.id),
    city: text('city'),

    contactName: text('contact_name').notNull(),
    contactPosition: text('contact_position'),
    contactPhone: text('contact_phone').notNull(),
    contactEmail: text('contact_email').notNull(),

    /** What the applicant expects to bring — sizing, not a commitment. */
    expectedAnnualVolumeKg: weightKg('expected_annual_volume_kg'),
    expectedKeshaPerSeason: keshaCount('expected_kesha_per_season'),
    primaryCoffeeTypeId: uuid('primary_coffee_type_id').references(() => coffeeType.id),
    intendedServices: text('intended_services'),

    /**
     * DRAFT → SUBMITTED → UNDER_REVIEW → (INFO_REQUESTED ⇄ UNDER_REVIEW) → APPROVED | REJECTED
     * Also WITHDRAWN, by the applicant, from any pre-decision state.
     */
    status: text('status').notNull().default('DRAFT'),
    submittedAt: instant('submitted_at'),
    reviewStartedAt: instant('review_started_at'),
    reviewedBy: uuid('reviewed_by'),
    decidedAt: instant('decided_at'),
    decidedBy: uuid('decided_by'),
    decisionNote: text('decision_note'),
    rejectionReason: text('rejection_reason'),
    /** What the reviewer still needs. Shown verbatim on the public status page. */
    infoRequested: text('info_requested'),

    /** Set on approval. The link between the application and the customer it produced. */
    customerId: uuid('customer_id').references(() => customer.id),

    /** Anti-abuse context for the anonymous submit path. */
    submittedIp: text('submitted_ip'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_customer_application__reference').on(t.reference),
    index('idx_customer_application__status').on(t.status, t.createdAt),
    index('idx_customer_application__branch').on(t.branchId),
    index('idx_customer_application__customer').on(t.customerId),
    index('idx_customer_application__contact_email').on(t.contactEmail),
    check(
      'ck_customer_application__status',
      sql`${t.status} in ('DRAFT','SUBMITTED','UNDER_REVIEW','INFO_REQUESTED','APPROVED','REJECTED','WITHDRAWN')`,
    ),
    // An approved application must carry the customer it produced. Enforced here rather
    // than in application code, because this is the one invariant that makes the M07/M08
    // link trustworthy.
    check(
      'ck_customer_application__approved_has_customer',
      sql`${t.status} <> 'APPROVED' or ${t.customerId} is not null`,
    ),
  ],
)

/** A KYC document attached to an application, and its verification verdict. */
export const applicationDocument = pgTable(
  'application_document',
  {
    id: uuid('id').primaryKey(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => customerApplication.id, { onDelete: 'cascade' }),
    documentTypeId: uuid('document_type_id')
      .notNull()
      .references(() => kycDocumentType.id),
    fileId: uuid('file_id').references(() => storedFile.id),

    documentNumber: text('document_number'),
    issuedOn: calendarDate('issued_on'),
    expiresOn: calendarDate('expires_on'),

    /** PENDING | VERIFIED | REJECTED */
    verificationStatus: text('verification_status').notNull().default('PENDING'),
    verifiedBy: uuid('verified_by'),
    verifiedAt: instant('verified_at'),
    rejectionReason: text('rejection_reason'),
    ...auditColumns(),
  },
  (t) => [
    index('idx_application_document__application').on(t.applicationId),
    uniqueIndex('uq_application_document__type').on(t.applicationId, t.documentTypeId),
    check(
      'ck_application_document__verification',
      sql`${t.verificationStatus} in ('PENDING','VERIFIED','REJECTED')`,
    ),
  ],
)

/**
 * The review trail, append-only.
 *
 * An application that was rejected, appealed and then approved has to be explicable months
 * later. Mutating a single `status` column loses exactly that.
 */
export const applicationStatusHistory = pgTable(
  'application_status_history',
  {
    id: uuid('id').primaryKey(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => customerApplication.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    note: text('note'),
    /** True when the actor was the applicant rather than a staff member. */
    byApplicant: boolean('by_applicant').notNull().default(false),
    changedAt: instant('changed_at')
      .notNull()
      .default(sql`now()`),
    changedBy: uuid('changed_by'),
  },
  (t) => [
    index('idx_application_status_history__application').on(t.applicationId, t.changedAt),
  ],
)

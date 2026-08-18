import {
  pgTable,
  text,
  uuid,
  bigint,
  index,
  uniqueIndex,
  check,
  integer,
  jsonb,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  appendOnlyColumns,
  activeFlag,
  instant,
  sourceReference,
} from '../helpers/columns'
import { branch } from './master-data'
import { storedFile } from './files'
import { customer } from './customer'

/**
 * M06 — Printing, Documents, Barcodes & QR.
 *
 * Ethiopian coffee operations run on paper, and the paper is the legal artefact. Two
 * consequences shape this module:
 *
 *  1. Every print is LOGGED, append-only, with a sequential copy number. "Which copy of the
 *     goods receipt did the driver take, and who printed the third one?" must be answerable.
 *  2. Every printed document carries a QR code resolving to a verification page. A photocopy
 *     with an altered weight then fails against the system, which is the only practical
 *     defence against document tampering in a paper-first process.
 */

/**
 * Gapless document numbering.
 *
 * Deliberately NOT a Postgres sequence: `nextval()` is non-transactional, so a rolled-back
 * goods receipt would still burn its GRN number and leave a hole. A number missing from a
 * custody file is a question EthioStar cannot answer in a dispute. Allocation is therefore
 * an `UPDATE … RETURNING` inside the caller's transaction — see
 * `modules/printing/domain/number-series.ts`.
 */
export const documentNumberSeries = pgTable(
  'document_number_series',
  {
    id: uuid('id').primaryKey(),
    /** One of the DOCUMENT_SERIES codes in config/constants.ts. */
    seriesCode: text('series_code').notNull(),
    /** NULL means one global series — what a single-site deployment wants. */
    branchId: uuid('branch_id').references(() => branch.id),
    /** Numbering resets per year; the year is part of the document's identity. */
    resetYear: integer('reset_year').notNull(),
    prefix: text('prefix').notNull(),
    /** The NEXT number to issue. */
    nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
    padding: integer('padding').notNull().default(6),
    description: text('description'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    // NULLS NOT DISTINCT is applied in migration 0027 — Drizzle cannot express it here, and
    // without it two global series rows could coexist and both receive the same increment.
    uniqueIndex('uq_document_number_series__key').on(t.seriesCode, t.branchId, t.resetYear),
    index('idx_document_number_series__active').on(t.seriesCode, t.isActive),
    check('ck_document_number_series__next_value', sql`${t.nextValue} >= 1`),
    check('ck_document_number_series__padding', sql`${t.padding} between 1 and 12`),
    check('ck_document_number_series__reset_year', sql`${t.resetYear} between 2000 and 2200`),
  ],
)

export const documentTemplate = pgTable(
  'document_template',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    /** GOODS_RECEIPT | GATE_PASS | ACCEPTANCE | DELIVERY_NOTE | COFFEE_PASSPORT | LABEL */
    documentType: text('document_type').notNull(),
    /** Distinct from auditColumns().version — this is the TEMPLATE revision, published
     * deliberately, not the optimistic-concurrency counter. */
    templateVersion: integer('template_version').notNull().default(1),
    locale: text('locale').notNull().default('en'),
    title: text('title').notNull(),
    /** Layout definition consumed by the renderer. */
    layout: jsonb('layout'),
    /** A4 | A5 | LABEL_100X150 */
    pageSize: text('page_size').notNull().default('A4'),
    branchId: uuid('branch_id').references(() => branch.id),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_document_template__key').on(t.code, t.locale, t.templateVersion),
    index('idx_document_template__type').on(t.documentType, t.isActive),
    check('ck_document_template__locale', sql`${t.locale} in ('en','am')`),
  ],
)

/**
 * One row per physical print. Append-only, deliberately.
 *
 * `copyNo` increments per source document, so a reprint is visible as a reprint rather than
 * being indistinguishable from the original.
 */
export const printedDocument = pgTable(
  'printed_document',
  {
    id: uuid('id').primaryKey(),
    templateId: uuid('template_id').references(() => documentTemplate.id),
    documentType: text('document_type').notNull(),
    /** What was printed — goods receipt, acceptance, dispatch order. */
    ...sourceReference(),
    /** The reference printed on the page, so the log is searchable by what a person holds. */
    documentReference: text('document_reference'),
    /**
     * Denormalised from the source record at print time, NOT a polymorphic join.
     *
     * `source_type`/`source_id` vary per document (goods_receipt, gate_pass, acceptance, …),
     * and a portal customer must be able to see their own printed documents without the
     * "unreadable, only as correct as its longest branch" polymorphic RLS policy migration
     * 0022 explicitly avoided. A flat `customer_id` column lets the customer-scoped policy
     * below be a single, ordinary equality check instead.
     */
    customerId: uuid('customer_id').references(() => customer.id),

    copyNo: integer('copy_no').notNull().default(1),
    /** True for anything after the first. Printed on the page itself. */
    isReprint: text('is_reprint').generatedAlwaysAs(
      sql`case when copy_no > 1 then 'Y' else 'N' end`,
    ),
    reprintReason: text('reprint_reason'),

    /** The token the QR code resolves to. Random — a document id must not be guessable. */
    verificationToken: text('verification_token').notNull(),
    /** Snapshot of the values printed, so verification compares like with like. */
    printedSnapshot: jsonb('printed_snapshot'),

    fileId: uuid('file_id').references(() => storedFile.id),
    /**
     * Denormalised from `stored_file.object_key` at print time.
     *
     * `stored_file` carries a staff-only RLS policy (migration 0022) — reasonable for the
     * general upload table, where a bare `source_type`/`source_id` join cannot express
     * customer ownership without repeating the same polymorphic-policy problem migration
     * 0022 already rejected once. The download route (`/api/v1/documents/[id]/pdf`) needs to
     * resolve straight from a `printed_document` row a customer's own RLS policy already
     * proved they may see, without a second, harder-to-express join through `stored_file`.
     */
    objectKey: text('object_key').notNull(),
    locale: text('locale').notNull().default('en'),
    printedBy: uuid('printed_by').notNull(),
    printedAt: instant('printed_at')
      .notNull()
      .default(sql`now()`),
    printerName: text('printer_name'),
    ...appendOnlyColumns(),
  },
  (t) => [
    uniqueIndex('uq_printed_document__token').on(t.verificationToken),
    uniqueIndex('uq_printed_document__copy').on(t.sourceType, t.sourceId, t.copyNo),
    index('idx_printed_document__source').on(t.sourceType, t.sourceId),
    index('idx_printed_document__reference').on(t.documentReference),
    index('idx_printed_document__customer').on(t.customerId, t.printedAt),
    index('idx_printed_document__printed_by').on(t.printedBy, t.printedAt),
    check('ck_printed_document__copy_no', sql`${t.copyNo} >= 1`),
    // A reprint says why. It is the difference between an audit trail and a stack of paper.
    check(
      'ck_printed_document__reprint_reason',
      sql`${t.copyNo} = 1 or ${t.reprintReason} is not null`,
    ),
  ],
)

/**
 * Verification scans, append-only.
 *
 * Someone scanning a document that does not verify is a signal worth keeping — repeated
 * failures against one reference is what a forged document looks like.
 */
export const documentVerification = pgTable(
  'document_verification',
  {
    id: uuid('id').primaryKey(),
    printedDocumentId: uuid('printed_document_id').references(() => printedDocument.id),
    /** The token presented — kept even when it matched nothing. */
    presentedToken: text('presented_token').notNull(),
    /** VALID | NOT_FOUND | SUPERSEDED */
    result: text('result').notNull(),
    scannedBy: uuid('scanned_by'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    scannedAt: instant('scanned_at')
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('idx_document_verification__document').on(t.printedDocumentId, t.scannedAt),
    index('idx_document_verification__failures')
      .on(t.presentedToken, t.scannedAt)
      .where(sql`${t.result} <> 'VALID'`),
    check(
      'ck_document_verification__result',
      sql`${t.result} in ('VALID','NOT_FOUND','SUPERSEDED')`,
    ),
  ],
)

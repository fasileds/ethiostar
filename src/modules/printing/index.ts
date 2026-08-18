/**
 * M06 — Printing, Documents, Barcodes & QR.
 *
 * Every print is logged with a copy number; every printed document carries a QR code
 * resolving to a verification page, which is the only practical defence against document
 * tampering in a paper-first process.
 */

export { recentPrints, type PrintLogRow } from './application/print-log.query'

export {
  allocateDocumentNumber,
  listNumberSeries,
  type AllocatedNumber,
  type AllocateOptions,
  type SeriesRow,
} from './infrastructure/number-series.repository'

export {
  formatDocumentNumber,
  parseDocumentNumber,
  resetYearFor,
  type ParsedDocumentNumber,
} from './domain/number-series'

export {
  nextCopyNumber,
  prepareVerification,
  finalizePrint,
  type PreparedVerification,
  type FinalizePrintInput,
  type FinalizedPrint,
} from './application/record-print'

export {
  findPrintedDocument,
  type PrintedDocumentRecord,
} from './infrastructure/printed-document.repository'

export {
  verifyPresentedToken,
  type VerifiedDocument,
  type VerificationResult,
  type ScanContext,
} from './infrastructure/system/verify-document'

export {
  listDocumentTemplates,
  createDocumentTemplate,
  setDocumentTemplateActive,
  type DocumentTemplateAdminRow,
  type CreateDocumentTemplateInput,
} from './infrastructure/document-template-admin.repository'

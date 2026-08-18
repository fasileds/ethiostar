import 'server-only'
import type { DocumentSeriesCode } from '@config/constants'
import { RECEIVING_AND_STORAGE_ENTRIES } from './entries/receiving-and-storage'
import { DISPATCH_ENTRIES } from './entries/dispatch-entries'
import { STOCK_ENTRIES } from './entries/stock-entries'
import { PROCESSING_ENTRIES } from './entries/processing-entries'
import { OTHER_ENTRIES } from './entries/other-entries'
import { BILLING_ENTRIES } from './entries/billing-entries'
import type { DocumentRegistryEntry } from './types'

export type { CommonPrintProps, LoadedDocument, DocumentRegistryEntry } from './types'

/**
 * The printable-document registry — one entry per M06 §7.1 document type (all 18).
 *
 * Lives in `server/`, not in `modules/printing/`, because loading a document's data is
 * necessarily owned by the module that has it (inbound for a GRN, dispatch for a gate pass,
 * acceptance for a Mirt Merekebiya, …), and `eslint.config.mjs`'s module tiers only allow a
 * module to import a STRICTLY LOWER tier. `printing` sits at tier 2; most of the modules that
 * own printable documents sit above it. `server` and `app` are the two layers exempted from
 * tiering — they may import any module — so this is where the fan-out belongs.
 *
 * The entries themselves live in `entries/*.tsx`, grouped by owning module, so no single file
 * grows past the project's line-count lint cap. Adding a document type is: one template in
 * `platform/pdf/templates/`, one loader in the owning module's `application/` layer (exported
 * through its `index.ts`), and one entry in the matching `entries/*.tsx` file (or a new one).
 */
export const DOCUMENT_REGISTRY: Partial<Record<DocumentSeriesCode, DocumentRegistryEntry>> = {
  ...RECEIVING_AND_STORAGE_ENTRIES,
  ...DISPATCH_ENTRIES,
  ...STOCK_ENTRIES,
  ...PROCESSING_ENTRIES,
  ...OTHER_ENTRIES,
  ...BILLING_ENTRIES,
}

export type RegisteredDocumentType = keyof typeof DOCUMENT_REGISTRY

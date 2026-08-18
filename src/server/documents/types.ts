import 'server-only'
import type { ReactElement } from 'react'
import type { DocumentProps } from '@react-pdf/renderer'
import type { Tx } from '@db/client'
import type { Locale } from '@config/constants'

/**
 * Shared types for the printable-document registry (see `registry.tsx`). Split into its own
 * file so the per-module entry files (`entries/*.tsx`) can import these without a circular
 * dependency back on `registry.tsx`, which imports THEM.
 */

export interface CommonPrintProps {
  readonly organisationName: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string
}

export interface LoadedDocument {
  /** The reference already printed on the source record (e.g. `GRN-2026-000045`), or null
   *  for a document type that has no separate numbering series. */
  readonly documentReference: string | null
  readonly customerId: string | null
  /** Stored verbatim in `printed_document.printed_snapshot` — a later edit to the source
   *  record must not change what an already-issued document says. */
  readonly snapshot: unknown
  readonly element: (common: CommonPrintProps) => ReactElement<DocumentProps>
}

export interface DocumentRegistryEntry {
  /** The value written to `printed_document.source_type` / read back for `copyNo`. */
  readonly sourceType: string
  readonly load: (tx: Tx, sourceId: string) => Promise<LoadedDocument | undefined>
}

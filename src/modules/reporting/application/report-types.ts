import type { Tx } from '@db/client'
import type { CsvColumn } from '../domain/csv'

/**
 * Shared types for THE STANDARD REPORT LIBRARY (M21, client document §7.2).
 *
 * A fixed catalogue, not a query builder — every report is a named, reviewed SQL statement.
 * This is what turns the report list, the viewer page and the CSV export route into three
 * generic pieces of UI instead of one per report: each entry carries its own permission,
 * column set and runner, and the three consumers just iterate the catalogue.
 */

export type ReportCategory = 'operations' | 'inventory' | 'yield' | 'commercial' | 'governance'

export const REPORT_CATEGORIES: readonly {
  readonly key: ReportCategory
  readonly label: string
}[] = [
  { key: 'operations', label: 'Operations' },
  { key: 'inventory', label: 'Store & inventory' },
  { key: 'yield', label: 'Yield & output' },
  { key: 'commercial', label: 'Commercial & financial' },
  { key: 'governance', label: 'Governance' },
]

/** The union of every parameter any report might need. Each report reads only what it uses. */
export interface ReportRunParams {
  readonly branchId: string | null
  readonly date: string
  readonly periodStart: string
  readonly periodEnd: string
  readonly asOfDate: string
}

export interface ReportDefinition {
  readonly key: string
  readonly category: ReportCategory
  readonly title: string
  readonly description: string
  /** `report:view_financial` for commercial reports; `report:view_operational` otherwise. */
  readonly permission: string
  readonly columns: readonly CsvColumn<Record<string, unknown>>[]
  readonly run: (tx: Tx, params: ReportRunParams) => Promise<readonly Record<string, unknown>[]>
}

/**
 * Every report row is a plain object of primitives, just typed narrowly by its own query
 * function — safe to widen to `Record<string, unknown>` for the generic table/CSV consumers.
 */
export function toRecords<T>(rows: readonly T[]): readonly Record<string, unknown>[] {
  return rows as unknown as readonly Record<string, unknown>[]
}

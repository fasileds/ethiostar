import { OPERATIONS_REPORTS } from './reports/catalogue-operations'
import { INVENTORY_REPORTS } from './reports/catalogue-inventory'
import { YIELD_REPORTS } from './reports/catalogue-yield'
import { COMMERCIAL_REPORTS } from './reports/catalogue-commercial'
import { GOVERNANCE_REPORTS } from './reports/catalogue-governance'
import type { ReportCategory, ReportDefinition } from './report-types'

export {
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportRunParams,
  type ReportDefinition,
} from './report-types'

/**
 * THE STANDARD REPORT LIBRARY (M21, client document §7.2) — the five category catalogues,
 * assembled into one list. Each category's reports live in their own file
 * (`reports/catalogue-*.ts`) so no single file grows past a screenful; this file is just the
 * join, plus the two lookups the report list, viewer and CSV route all need.
 */
export const REPORTS: readonly ReportDefinition[] = [
  ...OPERATIONS_REPORTS,
  ...INVENTORY_REPORTS,
  ...YIELD_REPORTS,
  ...COMMERCIAL_REPORTS,
  ...GOVERNANCE_REPORTS,
]

export function findReport(category: string, key: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.category === category && r.key === key)
}

export function reportsByCategory(category: ReportCategory): readonly ReportDefinition[] {
  return REPORTS.filter((r) => r.category === category)
}

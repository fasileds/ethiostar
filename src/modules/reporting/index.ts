/**
 * M21 — Reporting, Dashboards & Business Intelligence.
 *
 * The PUBLIC API of this module. Other modules (and the staff app) import only from here.
 */

export {
  operationalDashboard,
  type OperationalDashboardData,
} from './application/operational-dashboard.query'

export {
  roleDashboard,
  type RoleDashboardData,
  type GeneralManagerTiles,
  type StoreManagerTiles,
  type ProductionOperatorTiles,
  type OperationalFallbackTiles,
} from './application/role-dashboard.query'

export {
  REPORTS,
  REPORT_CATEGORIES,
  findReport,
  reportsByCategory,
  type ReportDefinition,
  type ReportCategory,
  type ReportRunParams,
} from './application/report-catalogue'

export { rowsToCsv, type CsvColumn } from './domain/csv'

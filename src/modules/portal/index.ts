/**
 * M09 — Customer Self-Service Portal, and the shared dashboard read models.
 *
 * A QUERY layer returning DTOs, not entities. M21 (Phase 2) builds its dashboards and BI on
 * this same layer rather than querying aggregates — see docs/architecture/07-extension-points.md.
 */

export {
  stockByStatus,
  totalInCustody,
  operationalCounts,
  recentConsignments,
  roomOccupancy,
  dailyIntake,
  type StockByStatus,
  type OperationalCounts,
  type RecentConsignment,
  type RoomOccupancy,
  type DailyIntake,
} from './application/dashboard.query'

import { toRecords, type ReportDefinition } from '../report-types'
import {
  dailyOperationsSummary,
  consignmentStatusByCustomer,
  appointmentDelaysByCause,
} from './operations-reports'

export const OPERATIONS_REPORTS: readonly ReportDefinition[] = [
  {
    key: 'daily-operations-summary',
    category: 'operations',
    title: 'Daily operations summary',
    description:
      'Goods received, jobs completed, acceptances issued and dispatches, for one day.',
    permission: 'report:view_operational',
    columns: [
      { key: 'metric', header: 'Metric' },
      { key: 'count', header: 'Count' },
      { key: 'quantityKg', header: 'Quantity (kg)' },
    ],
    run: async (tx, p) =>
      toRecords(await dailyOperationsSummary(tx, { branchId: p.branchId, date: p.date })),
  },
  {
    key: 'consignment-status-by-customer',
    category: 'operations',
    title: 'Consignment status by customer',
    description: 'Every consignment, grouped by customer and current stage.',
    permission: 'report:view_operational',
    columns: [
      { key: 'customerName', header: 'Customer' },
      { key: 'status', header: 'Status' },
      { key: 'consignments', header: 'Consignments' },
      { key: 'quantityKg', header: 'Quantity (kg)' },
    ],
    run: async (tx, p) =>
      toRecords(await consignmentStatusByCustomer(tx, { branchId: p.branchId })),
  },
  {
    key: 'appointment-delays-by-cause',
    category: 'operations',
    title: 'Appointment delay/reschedule by cause',
    description: 'Recorded schedule delays over a period, grouped by cause.',
    permission: 'report:view_operational',
    columns: [
      { key: 'causeCode', header: 'Cause' },
      { key: 'occurrences', header: 'Occurrences' },
      { key: 'totalDelayMinutes', header: 'Total delay (min)' },
      { key: 'affectedAppointments', header: 'Appointments affected' },
    ],
    run: async (tx, p) =>
      toRecords(
        await appointmentDelaysByCause(tx, {
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
        }),
      ),
  },
]

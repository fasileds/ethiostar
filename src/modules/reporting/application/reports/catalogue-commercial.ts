import { toRecords, type ReportDefinition } from '../report-types'
import {
  revenueByCustomer,
  receivablesAgeing,
  labourCostByConsignment,
} from './commercial-reports'

export const COMMERCIAL_REPORTS: readonly ReportDefinition[] = [
  {
    key: 'revenue-by-customer',
    category: 'commercial',
    title: 'Revenue by service/customer',
    description: 'Charge events raised over a period, grouped by customer and service.',
    permission: 'report:view_financial',
    columns: [
      { key: 'customerName', header: 'Customer' },
      { key: 'serviceCode', header: 'Service' },
      { key: 'chargeCount', header: 'Charges' },
      { key: 'totalAmount', header: 'Total amount' },
    ],
    run: async (tx, p) =>
      toRecords(
        await revenueByCustomer(tx, {
          branchId: p.branchId,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
        }),
      ),
  },
  {
    key: 'receivables-ageing',
    category: 'commercial',
    title: 'Receivables ageing',
    description: 'Outstanding invoices as of a date, oldest overdue first.',
    permission: 'report:view_financial',
    columns: [
      { key: 'customerName', header: 'Customer' },
      { key: 'invoiceReference', header: 'Invoice' },
      { key: 'dueDate', header: 'Due date' },
      { key: 'daysOverdue', header: 'Days overdue' },
      { key: 'outstandingAmount', header: 'Outstanding' },
    ],
    run: async (tx, p) =>
      toRecords(await receivablesAgeing(tx, { branchId: p.branchId, asOfDate: p.asOfDate })),
  },
  {
    key: 'labour-cost-by-consignment',
    category: 'commercial',
    title: 'Labour cost per consignment/customer',
    description: 'Approved labour output over a period, costed and grouped by consignment.',
    permission: 'report:view_financial',
    columns: [
      { key: 'consignmentReference', header: 'Consignment' },
      { key: 'customerName', header: 'Customer' },
      { key: 'outputLines', header: 'Output lines' },
      { key: 'totalKg', header: 'Total (kg)' },
      { key: 'totalCost', header: 'Total cost' },
    ],
    run: async (tx, p) =>
      toRecords(
        await labourCostByConsignment(tx, {
          branchId: p.branchId,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
        }),
      ),
  },
]

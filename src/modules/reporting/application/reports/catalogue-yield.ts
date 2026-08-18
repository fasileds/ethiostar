import { toRecords, type ReportDefinition } from '../report-types'
import {
  yieldAnalysisByCustomer,
  outputClassificationBreakdown,
  massBalanceExceptions,
} from './yield-reports'

export const YIELD_REPORTS: readonly ReportDefinition[] = [
  {
    key: 'yield-by-customer',
    category: 'yield',
    title: 'Yield by customer/coffee type',
    description: 'Completed jobs over a period: input, output, loss and average yield %.',
    permission: 'report:view_operational',
    columns: [
      { key: 'customerName', header: 'Customer' },
      { key: 'coffeeTypeName', header: 'Coffee type' },
      { key: 'jobsCompleted', header: 'Jobs' },
      { key: 'inputKg', header: 'Input (kg)' },
      { key: 'outputKg', header: 'Output (kg)' },
      { key: 'lossKg', header: 'Loss (kg)' },
      { key: 'avgYieldPct', header: 'Avg yield %' },
    ],
    run: async (tx, p) =>
      toRecords(
        await yieldAnalysisByCustomer(tx, {
          branchId: p.branchId,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
        }),
      ),
  },
  {
    key: 'output-classification-breakdown',
    category: 'yield',
    title: 'Output classification breakdown',
    description: 'Processing output over a period, by graded classification.',
    permission: 'report:view_operational',
    columns: [
      { key: 'classificationName', header: 'Classification' },
      { key: 'isExportReady', header: 'Export-ready' },
      { key: 'outputLines', header: 'Output lines' },
      { key: 'quantityKg', header: 'Quantity (kg)' },
    ],
    run: async (tx, p) =>
      toRecords(
        await outputClassificationBreakdown(tx, {
          branchId: p.branchId,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
        }),
      ),
  },
  {
    key: 'mass-balance-exceptions',
    category: 'yield',
    title: 'Process loss / mass-balance exceptions',
    description: 'Jobs closed outside tolerance over a period.',
    permission: 'report:view_operational',
    columns: [
      { key: 'jobReference', header: 'Job' },
      { key: 'customerName', header: 'Customer' },
      { key: 'plannedInputKg', header: 'Planned input (kg)' },
      { key: 'actualInputKg', header: 'Actual input (kg)' },
      { key: 'actualOutputKg', header: 'Actual output (kg)' },
      { key: 'varianceKg', header: 'Variance (kg)' },
      { key: 'toleranceAppliedPct', header: 'Tolerance %' },
      { key: 'closedAt', header: 'Closed at' },
    ],
    run: async (tx, p) =>
      toRecords(
        await massBalanceExceptions(tx, {
          branchId: p.branchId,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
        }),
      ),
  },
]

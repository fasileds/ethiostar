import { toRecords, type ReportDefinition } from '../report-types'
import {
  userAccessReview,
  stockAdjustmentAudit,
  configurationChangeHistory,
} from './governance-reports'

export const GOVERNANCE_REPORTS: readonly ReportDefinition[] = [
  {
    key: 'user-access-review',
    category: 'governance',
    title: 'User access / dormant accounts',
    description: 'Staff accounts flagged dormant, or unseen for 30 days or more.',
    permission: 'report:view_operational',
    columns: [
      { key: 'fullName', header: 'Name' },
      { key: 'email', header: 'Email' },
      { key: 'status', header: 'Status' },
      { key: 'lastSeenAt', header: 'Last seen' },
      { key: 'daysSinceLastSeen', header: 'Days since seen' },
    ],
    run: async (tx) => toRecords(await userAccessReview(tx)),
  },
  {
    key: 'stock-adjustment-audit',
    category: 'governance',
    title: 'Stock adjustment audit',
    description: 'Every stock adjustment over a period, with its reason code and actor.',
    permission: 'report:view_operational',
    columns: [
      { key: 'reference', header: 'Reference' },
      { key: 'lotReference', header: 'Lot' },
      { key: 'reasonCode', header: 'Reason' },
      { key: 'isException', header: 'Exception' },
      { key: 'quantityKgDelta', header: 'Delta (kg)' },
      { key: 'narrative', header: 'Narrative' },
      { key: 'occurredAt', header: 'Occurred at' },
      { key: 'actorName', header: 'Actor' },
    ],
    run: async (tx, p) =>
      toRecords(
        await stockAdjustmentAudit(tx, { periodStart: p.periodStart, periodEnd: p.periodEnd }),
      ),
  },
  {
    key: 'configuration-change-history',
    category: 'governance',
    title: 'Configuration change history',
    description: 'Every system setting change over a period, old value to new.',
    permission: 'report:view_operational',
    columns: [
      { key: 'settingKey', header: 'Setting' },
      { key: 'oldValue', header: 'Old value' },
      { key: 'newValue', header: 'New value' },
      { key: 'reason', header: 'Reason' },
      { key: 'changedBy', header: 'Changed by' },
      { key: 'changedAt', header: 'Changed at' },
    ],
    run: async (tx, p) =>
      toRecords(
        await configurationChangeHistory(tx, {
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
        }),
      ),
  },
]

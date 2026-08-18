import { toRecords, type ReportDefinition } from '../report-types'
import {
  stockOnHandByLocation,
  occupancyByLocation,
  ageingStockReport,
  movementRegister,
} from './inventory-reports'

export const INVENTORY_REPORTS: readonly ReportDefinition[] = [
  {
    key: 'stock-on-hand-by-location',
    category: 'inventory',
    title: 'Stock on hand by customer/room/section/lot',
    description: 'Every lot currently in store, with its exact location.',
    permission: 'report:view_operational',
    columns: [
      { key: 'customerName', header: 'Customer' },
      { key: 'warehouseName', header: 'Warehouse' },
      { key: 'roomCode', header: 'Room' },
      { key: 'sectionCode', header: 'Section' },
      { key: 'lotReference', header: 'Lot' },
      { key: 'quantityKg', header: 'Quantity (kg)' },
      { key: 'keshaCount', header: 'Kesha' },
    ],
    run: async (tx, p) => toRecords(await stockOnHandByLocation(tx, { branchId: p.branchId })),
  },
  {
    key: 'occupancy-by-location',
    category: 'inventory',
    title: 'Occupancy and available capacity',
    description: 'Used vs safe capacity, by warehouse, room and section.',
    permission: 'report:view_operational',
    columns: [
      { key: 'warehouseName', header: 'Warehouse' },
      { key: 'roomCode', header: 'Room' },
      { key: 'sectionCode', header: 'Section' },
      { key: 'usedKg', header: 'Used (kg)' },
      { key: 'capacityKg', header: 'Safe capacity (kg)' },
      { key: 'occupancyPct', header: 'Occupancy %' },
    ],
    run: async (tx, p) => toRecords(await occupancyByLocation(tx, { branchId: p.branchId })),
  },
  {
    key: 'ageing-stock',
    category: 'inventory',
    title: 'Ageing stock & dwell time',
    description: 'Lots still in store, oldest first, with days in storage as of a date.',
    permission: 'report:view_operational',
    columns: [
      { key: 'customerName', header: 'Customer' },
      { key: 'lotReference', header: 'Lot' },
      { key: 'storageStartDate', header: 'Storage start' },
      { key: 'dwellDays', header: 'Dwell days' },
      { key: 'quantityKg', header: 'Quantity (kg)' },
    ],
    run: async (tx, p) =>
      toRecords(await ageingStockReport(tx, { branchId: p.branchId, asOfDate: p.asOfDate })),
  },
  {
    key: 'movement-register',
    category: 'inventory',
    title: 'Movement register',
    description: 'Every stock ledger movement over a period (most recent 1,000).',
    permission: 'report:view_operational',
    columns: [
      { key: 'occurredAt', header: 'Occurred at' },
      { key: 'movementType', header: 'Type' },
      { key: 'lotReference', header: 'Lot' },
      { key: 'locationCode', header: 'Location' },
      { key: 'quantityKg', header: 'Quantity (kg)' },
      { key: 'actorName', header: 'Actor' },
    ],
    run: async (tx, p) =>
      toRecords(
        await movementRegister(tx, {
          branchId: p.branchId,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
        }),
      ),
  },
]

import { sql } from 'drizzle-orm'
import { demoId, daysAgo } from './util'
import type { SeedContext } from '../types'

/**
 * M12 warehouses/rooms/sections, M14 machines, M17 vehicles, M18 labour rates, M20 storage
 * tiers — the physical and pricing scaffolding every operational module needs before a
 * single consignment can move through it.
 */

export interface OrgRefs {
  warehouseId: { main: string; bole: string }
  sectionId: {
    mainA1: string
    mainA2: string
    mainLoss: string
    boleB1: string
    boleLoss: string
  }
  machineId: { sorter: string; huller: string; grader: string; cleaner: string }
  vehicleId: readonly string[]
}

export async function seedOrgMaster(
  ctx: SeedContext,
  branchId: string,
  actorId: string,
): Promise<OrgRefs> {
  const { log } = ctx

  // ── Warehouses ────────────────────────────────────────────────────────────
  const whMainId = demoId('warehouse:main')
  const whBoleId = demoId('warehouse:bole')
  for (const [id, code, en] of [
    [whMainId, 'WH-MAIN', 'Addis Ababa Central Warehouse'],
    [whBoleId, 'WH-BOLE', 'Bole Overflow Store'],
  ] as const) {
    await ctx.tx.execute(sql`
      insert into public.warehouse (id, branch_id, code, name_en, created_by)
      values (${id}, ${branchId}, ${code}, ${en}, ${actorId})
      on conflict (code) do update set name_en = excluded.name_en
    `)
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────
  const rooms = [
    { id: demoId('room:main-a1'), whId: whMainId, code: 'RM-A1', en: 'Room A1' },
    { id: demoId('room:main-a2'), whId: whMainId, code: 'RM-A2', en: 'Room A2 (Loss Account)' },
    { id: demoId('room:bole-b1'), whId: whBoleId, code: 'RM-B1', en: 'Room B1' },
  ]
  for (const r of rooms) {
    await ctx.tx.execute(sql`
      insert into public.store_room (id, warehouse_id, code, name_en, created_by)
      values (${r.id}, ${r.whId}, ${r.code}, ${r.en}, ${actorId})
      on conflict (code) do update set name_en = excluded.name_en
    `)
  }

  // ── Sections ──────────────────────────────────────────────────────────────
  const mainA1 = demoId('section:main-a1-1')
  const mainA2 = demoId('section:main-a1-2')
  const mainLoss = demoId('section:main-a2-loss')
  const boleB1 = demoId('section:bole-b1-1')
  const boleLoss = demoId('section:bole-b1-loss')

  const sections = [
    { id: mainA1, roomId: rooms[0]!.id, code: 'SEC-A1-1', en: 'Section A1-1', loss: false },
    { id: mainA2, roomId: rooms[0]!.id, code: 'SEC-A1-2', en: 'Section A1-2', loss: false },
    {
      id: mainLoss,
      roomId: rooms[1]!.id,
      code: 'SEC-A2-LOSS',
      en: 'Process Loss Account (Main)',
      loss: true,
    },
    { id: boleB1, roomId: rooms[2]!.id, code: 'SEC-B1-1', en: 'Section B1-1', loss: false },
    {
      id: boleLoss,
      roomId: rooms[2]!.id,
      code: 'SEC-B1-LOSS',
      en: 'Process Loss Account (Bole)',
      loss: true,
    },
  ]
  for (const s of sections) {
    await ctx.tx.execute(sql`
      insert into public.store_section
        (id, room_id, code, name_en, capacity_kg, capacity_kesha, is_loss_account, created_by)
      values (${s.id}, ${s.roomId}, ${s.code}, ${s.en}, ${s.loss ? '50000.000' : '500000.000'},
              ${s.loss ? 1000 : 8000}, ${s.loss}, ${actorId})
      on conflict (code) do update set name_en = excluded.name_en
    `)
  }
  log(`warehouses: 2, rooms: ${rooms.length}, sections: ${sections.length} (2 loss accounts)`)

  // ── Machines ──────────────────────────────────────────────────────────────
  const machines = [
    {
      id: demoId('machine:sorter-1'),
      code: 'MCH-SORT-1',
      en: 'Colour Sorter Line 1',
      type: 'SORTER',
      status: 'AVAILABLE',
    },
    {
      id: demoId('machine:huller-1'),
      code: 'MCH-HULL-1',
      en: 'Huller Line 1',
      type: 'HULLER',
      status: 'AVAILABLE',
    },
    {
      id: demoId('machine:grader-1'),
      code: 'MCH-GRADE-1',
      en: 'Grader Line 1',
      type: 'GRADER',
      status: 'MAINTENANCE',
    },
    {
      id: demoId('machine:cleaner-1'),
      code: 'MCH-CLEAN-1',
      en: 'Cleaner Line 1',
      type: 'CLEANER',
      status: 'AVAILABLE',
    },
  ]
  for (const m of machines) {
    await ctx.tx.execute(sql`
      insert into public.machine
        (id, branch_id, code, name_en, machine_type, rated_capacity_kg_per_hour, status,
         status_note, created_by)
      values (${m.id}, ${branchId}, ${m.code}, ${m.en}, ${m.type}, '2500.000', ${m.status},
              ${m.status === 'MAINTENANCE' ? 'Scheduled belt replacement' : null}, ${actorId})
      on conflict (code) do update set name_en = excluded.name_en, status = excluded.status
    `)
    // A day of capacity, spanning last week through next week, for the scheduler to book into.
    for (let d = -7; d <= 7; d++) {
      await ctx.tx.execute(sql`
        insert into public.machine_capacity_day
          (id, machine_id, capacity_on, capacity_kg, capacity_kesha, is_blocked, blocked_reason,
           created_by)
        values (${demoId(`capacity_day:${m.code}:${d}`)}, ${m.id}, ${daysAgo(-d)}, '18000.000', 300,
                ${m.status === 'MAINTENANCE' && d === 0}, ${m.status === 'MAINTENANCE' && d === 0 ? 'Belt replacement' : null},
                ${actorId})
        on conflict (machine_id, capacity_on) do nothing
      `)
    }
  }
  log(`machines: ${machines.length} (1 in MAINTENANCE), each with a 15-day capacity calendar`)

  // ── Vehicles ──────────────────────────────────────────────────────────────
  const vehicles = [
    { plate: 'ET-3-A12345', type: 'TRUCK', owner: 'Selam Logistics plc' },
    { plate: 'ET-3-A22334', type: 'ISUZU', owner: 'Habesha Transport Sc' },
    { plate: 'ET-3-A33445', type: 'TRUCK', owner: 'Zemen Freight plc' },
    { plate: 'ET-2-B44556', type: 'TRAILER', owner: 'Oda Transport plc' },
    { plate: 'ET-2-B55667', type: 'PICKUP', owner: 'Independent Owner-Driver' },
    { plate: 'ET-3-A66778', type: 'TRUCK', owner: 'Selam Logistics plc' },
  ]
  const vehicleIds: string[] = []
  for (const v of vehicles) {
    const id = demoId(`vehicle:${v.plate}`)
    vehicleIds.push(id)
    await ctx.tx.execute(sql`
      insert into public.vehicle (id, plate_no, vehicle_type, capacity_kg, transporter_name, created_by)
      values (${id}, ${v.plate}, ${v.type}, '15000.000', ${v.owner}, ${actorId})
      on conflict (plate_no) do update set transporter_name = excluded.transporter_name
    `)
  }
  log(`vehicles: ${vehicles.length}`)

  // ── Labour rates (M18) — one per activity type, effective from the start of records ──
  const activityRates: Array<[string, string]> = [
    ['UNLOAD_TRUCK', '2.50'],
    ['LOAD_TO_LINE', '2.00'],
    ['LOAD_TRUCK', '2.75'],
    ['STACKING', '1.80'],
    ['RE_BAGGING', '3.20'],
  ]
  for (const [code, rate] of activityRates) {
    await ctx.tx.execute(sql`
      insert into public.labour_rate
        (id, branch_id, activity_type_id, rate_basis, rate_amount, effective_from, approved_by,
         created_by)
      select ${demoId(`labour_rate:${code}`)}, ${branchId}, la.id, 'PER_KESHA', ${rate},
             date '2026-01-01', ${actorId}, ${actorId}
      from public.labour_activity_type la where la.code = ${code}
      on conflict (id) do nothing
    `)
  }
  log(`labour rates: ${activityRates.length} (PER_KESHA, effective 2026-01-01)`)

  // ── Storage rate tiers (M20) ─────────────────────────────────────────────
  const tiers: Array<[number, string]> = [
    [0, '0.15'],
    [30, '0.25'],
    [60, '0.40'],
  ]
  for (const [fromDay, rate] of tiers) {
    await ctx.tx.execute(sql`
      insert into public.storage_rate_tier (id, branch_id, from_day, rate_per_kg_per_day, created_by)
      values (${demoId(`storage_tier:${fromDay}`)}, ${branchId}, ${fromDay}, ${rate}, ${actorId})
      on conflict (id) do nothing
    `)
  }
  log(`storage rate tiers: ${tiers.length}`)

  return {
    warehouseId: { main: whMainId, bole: whBoleId },
    sectionId: { mainA1, mainA2, mainLoss, boleB1, boleLoss },
    machineId: {
      sorter: machines[0]!.id,
      huller: machines[1]!.id,
      grader: machines[2]!.id,
      cleaner: machines[3]!.id,
    },
    vehicleId: vehicleIds,
  }
}

import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

/**
 * Admin CRUD for the M12 location hierarchy — warehouse → room → section.
 *
 * Operational reads for capacity checking live in `application/warehouse.query.ts` and only
 * ever see the active set through `vw_section_capacity`. This file is the write side used by
 * the admin screen, and its list query deliberately reads the base tables directly so
 * deactivated warehouses, rooms and sections stay visible for management.
 */

export interface BranchOption {
  readonly id: string
  readonly code: string
  readonly name: string
}

export async function listBranches(tx: Tx): Promise<BranchOption[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, name_en
      from public.branch
      where is_active
      order by name_en
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name_en),
  }))
}

export interface AdminSectionRow {
  readonly id: string
  readonly roomId: string
  readonly code: string
  readonly name: string
  readonly capacityKg: string
  readonly capacityKesha: number
  readonly isLossAccount: boolean
  readonly isActive: boolean
}

export interface AdminRoomRow {
  readonly id: string
  readonly warehouseId: string
  readonly code: string
  readonly name: string
  readonly lengthM: string | null
  readonly widthM: string | null
  readonly heightM: string | null
  readonly isActive: boolean
  readonly sections: readonly AdminSectionRow[]
}

export interface AdminWarehouseRow {
  readonly id: string
  readonly branchId: string
  readonly branchName: string
  readonly code: string
  readonly name: string
  readonly isActive: boolean
  readonly rooms: readonly AdminRoomRow[]
}

interface WarehouseAcc {
  branchId: string
  branchName: string
  code: string
  name: string
  isActive: boolean
  rooms: Map<string, RoomAcc>
}

interface RoomAcc {
  code: string
  name: string
  lengthM: string | null
  widthM: string | null
  heightM: string | null
  isActive: boolean
  sections: AdminSectionRow[]
}

/** Folds one joined row into the warehouse/room/section accumulator, in place. */
function mergeRow(warehouses: Map<string, WarehouseAcc>, row: Record<string, unknown>): void {
  const warehouseId = col.text(row.warehouse_id)

  let warehouse = warehouses.get(warehouseId)
  if (!warehouse) {
    warehouse = {
      branchId: col.text(row.branch_id),
      branchName: col.text(row.branch_name),
      code: col.text(row.warehouse_code),
      name: col.text(row.warehouse_name),
      isActive: col.bool(row.warehouse_active),
      rooms: new Map(),
    }
    warehouses.set(warehouseId, warehouse)
  }

  const roomId = col.textOrNull(row.room_id)
  if (!roomId) return

  let room = warehouse.rooms.get(roomId)
  if (!room) {
    room = {
      code: col.text(row.room_code),
      name: col.text(row.room_name),
      lengthM: col.numericOrNull(row.length_m),
      widthM: col.numericOrNull(row.width_m),
      heightM: col.numericOrNull(row.height_m),
      isActive: col.bool(row.room_active),
      sections: [],
    }
    warehouse.rooms.set(roomId, room)
  }

  const sectionId = col.textOrNull(row.section_id)
  if (!sectionId) return

  room.sections.push({
    id: sectionId,
    roomId,
    code: col.text(row.section_code),
    name: col.text(row.section_name),
    capacityKg: col.numeric(row.capacity_kg),
    capacityKesha: col.int(row.capacity_kesha),
    isLossAccount: col.bool(row.is_loss_account),
    isActive: col.bool(row.section_active),
  })
}

/**
 * The full warehouse → room → section tree, including inactive records at every level.
 *
 * One query, assembled in memory — the same shape as `warehouseTree`, but over the base
 * tables rather than the capacity view, because this screen's job is managing the hierarchy
 * itself, not the stock sitting inside it.
 */
export async function warehouseAdminTree(tx: Tx): Promise<AdminWarehouseRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        wh.id as warehouse_id, wh.branch_id, br.name_en as branch_name,
        wh.code as warehouse_code, wh.name_en as warehouse_name, wh.is_active as warehouse_active,
        rm.id as room_id, rm.code as room_code, rm.name_en as room_name,
        rm.length_m, rm.width_m, rm.height_m, rm.is_active as room_active,
        sec.id as section_id, sec.code as section_code, sec.name_en as section_name,
        sec.capacity_kg, sec.capacity_kesha, sec.is_loss_account, sec.is_active as section_active
      from public.warehouse wh
      join public.branch br on br.id = wh.branch_id
      left join public.store_room rm on rm.warehouse_id = wh.id
      left join public.store_section sec on sec.room_id = rm.id
      order by wh.code, rm.code, sec.code
    `,
  )

  const warehouses = new Map<string, WarehouseAcc>()
  for (const row of rows) mergeRow(warehouses, row)

  return [...warehouses.entries()].map(([warehouseId, warehouse]) => ({
    id: warehouseId,
    branchId: warehouse.branchId,
    branchName: warehouse.branchName,
    code: warehouse.code,
    name: warehouse.name,
    isActive: warehouse.isActive,
    rooms: [...warehouse.rooms.entries()].map(([roomId, room]) => ({
      id: roomId,
      warehouseId,
      code: room.code,
      name: room.name,
      lengthM: room.lengthM,
      widthM: room.widthM,
      heightM: room.heightM,
      isActive: room.isActive,
      sections: room.sections,
    })),
  }))
}

export interface CreateWarehouseInput {
  readonly branchId: string
  readonly code: string
  readonly nameEn: string
  readonly actorId: string
}

export async function createWarehouse(tx: Tx, input: CreateWarehouseInput): Promise<void> {
  await tx.execute(sql`
    insert into public.warehouse (
      id, branch_id, code, name_en, is_active, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.branchId}::uuid, ${input.code}, ${input.nameEn},
      true, ${input.actorId}::uuid, now(), now()
    )
  `)
}

export interface CreateRoomInput {
  readonly warehouseId: string
  readonly code: string
  readonly nameEn: string
  readonly lengthM: string | null
  readonly widthM: string | null
  readonly heightM: string | null
  readonly actorId: string
}

export async function createRoom(tx: Tx, input: CreateRoomInput): Promise<void> {
  await tx.execute(sql`
    insert into public.store_room (
      id, warehouse_id, code, name_en, length_m, width_m, height_m,
      is_active, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.warehouseId}::uuid, ${input.code}, ${input.nameEn},
      ${input.lengthM}::numeric, ${input.widthM}::numeric, ${input.heightM}::numeric,
      true, ${input.actorId}::uuid, now(), now()
    )
  `)
}

export interface CreateSectionInput {
  readonly roomId: string
  readonly code: string
  readonly nameEn: string
  readonly capacityKg: string
  readonly capacityKesha: number
  readonly isLossAccount: boolean
  readonly actorId: string
}

export async function createSection(tx: Tx, input: CreateSectionInput): Promise<void> {
  await tx.execute(sql`
    insert into public.store_section (
      id, room_id, code, name_en, capacity_kg, capacity_kesha, is_loss_account,
      is_active, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.roomId}::uuid, ${input.code}, ${input.nameEn},
      ${input.capacityKg}::numeric, ${input.capacityKesha}, ${input.isLossAccount},
      true, ${input.actorId}::uuid, now(), now()
    )
  `)
}

export async function setWarehouseActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.warehouse
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}

export async function setRoomActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.store_room
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}

export async function setSectionActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.store_section
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}

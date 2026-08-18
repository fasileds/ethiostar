import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * M12 read models.
 *
 * Everything reads `vw_section_capacity`, which nets ACTIVE, unexpired reservations off
 * physical capacity. Occupancy is never materialised: a stale figure means coffee accepted
 * against space that does not exist, which is the exact failure the module exists to prevent.
 */

export interface WarehouseTreeRoom {
  readonly roomId: string
  readonly roomCode: string
  readonly roomName: string
  readonly sections: readonly SectionCapacity[]
  readonly capacityKg: string
  readonly usedKg: string
  readonly occupancyPct: number
}

export interface SectionCapacity {
  readonly locationId: string
  readonly sectionCode: string
  readonly sectionName: string
  readonly capacityKg: string
  readonly capacityKesha: number
  readonly safeFillPct: string
  readonly usableKg: string
  readonly onHandKg: string
  readonly onHandKesha: number
  readonly reservedKg: string
  readonly reservedKesha: number
  readonly freeKg: string
  readonly occupancyPct: number
  readonly isLossAccount: boolean
}

export interface WarehouseTree {
  readonly warehouseId: string
  readonly warehouseCode: string
  readonly warehouseName: string
  readonly rooms: readonly WarehouseTreeRoom[]
}

/**
 * The full warehouse → room → section tree with live capacity.
 *
 * One query, assembled in memory. Three round trips would be simpler to write and would show
 * a room's rooms and its sections from different instants — on a screen whose entire job is
 * to be trusted about free space.
 */
export async function warehouseTree(tx: Tx): Promise<WarehouseTree[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        wh.id as warehouse_id, wh.code as warehouse_code, wh.name_en as warehouse_name,
        rm.id as room_id, rm.code as room_code, rm.name_en as room_name,
        v.location_id, v.section_code, s.name_en as section_name,
        v.capacity_kg, v.capacity_kesha, v.safe_fill_pct, v.is_loss_account,
        v.reserved_kg, v.reserved_kesha,
        coalesce(bal.on_hand_kg, 0)       as on_hand_kg,
        coalesce(bal.on_hand_kesha, 0)::int as on_hand_kesha
      from public.vw_section_capacity v
      join public.store_section s on s.id = v.location_id
      join public.store_room rm   on rm.id = v.room_id
      join public.warehouse wh    on wh.id = v.warehouse_id
      left join lateral (
        select sum(b.quantity_kg) as on_hand_kg, sum(b.kesha_count) as on_hand_kesha
        from public.stock_balance b
        where b.location_id = v.location_id and b.quantity_kg > 0
      ) bal on true
      order by wh.code, rm.code, v.section_code
    `,
  )

  const warehouses = new Map<
    string,
    {
      code: string
      name: string
      rooms: Map<string, { code: string; name: string; sections: SectionCapacity[] }>
    }
  >()

  for (const row of rows) {
    const warehouseId = col.text(row.warehouse_id)
    const roomId = col.text(row.room_id)

    let warehouse = warehouses.get(warehouseId)
    if (!warehouse) {
      warehouse = {
        code: col.text(row.warehouse_code),
        name: col.text(row.warehouse_name),
        rooms: new Map(),
      }
      warehouses.set(warehouseId, warehouse)
    }

    let room = warehouse.rooms.get(roomId)
    if (!room) {
      room = { code: col.text(row.room_code), name: col.text(row.room_name), sections: [] }
      warehouse.rooms.set(roomId, room)
    }

    const capacityKg = Number(col.numeric(row.capacity_kg))
    const safeFill = Number(col.numeric(row.safe_fill_pct))
    const usableKg = capacityKg * safeFill
    const onHandKg = Number(col.numeric(row.on_hand_kg))
    const reservedKg = Number(col.numeric(row.reserved_kg))
    const committedKg = onHandKg + reservedKg

    room.sections.push({
      locationId: col.text(row.location_id),
      sectionCode: col.text(row.section_code),
      sectionName: col.text(row.section_name),
      capacityKg: col.numeric(row.capacity_kg),
      capacityKesha: col.int(row.capacity_kesha),
      safeFillPct: col.numeric(row.safe_fill_pct),
      usableKg: usableKg.toFixed(3),
      onHandKg: col.numeric(row.on_hand_kg),
      onHandKesha: col.int(row.on_hand_kesha),
      reservedKg: col.numeric(row.reserved_kg),
      reservedKesha: col.int(row.reserved_kesha),
      freeKg: Math.max(usableKg - committedKg, 0).toFixed(3),
      // Occupancy counts reservations: space promised to an approved delivery is not free.
      occupancyPct: usableKg > 0 ? Math.round((committedKg / usableKg) * 100) : 0,
      isLossAccount: col.bool(row.is_loss_account),
    })
  }

  return [...warehouses.entries()].map(([warehouseId, warehouse]) => ({
    warehouseId,
    warehouseCode: warehouse.code,
    warehouseName: warehouse.name,
    rooms: [...warehouse.rooms.entries()].map(([roomId, room]) => {
      const capacityKg = room.sections.reduce((sum, s) => sum + Number(s.usableKg), 0)
      const usedKg = room.sections.reduce(
        (sum, s) => sum + Number(s.onHandKg) + Number(s.reservedKg),
        0,
      )
      return {
        roomId,
        roomCode: room.code,
        roomName: room.name,
        sections: room.sections,
        capacityKg: capacityKg.toFixed(3),
        usedKg: usedKg.toFixed(3),
        occupancyPct: capacityKg > 0 ? Math.round((usedKg / capacityKg) * 100) : 0,
      }
    }),
  }))
}

export interface ReservationRow {
  readonly id: string
  readonly sectionCode: string
  readonly roomCode: string
  readonly customerName: string
  readonly deliveryRequestReference: string | null
  readonly quantityKg: string
  readonly keshaCount: number
  readonly status: string
  readonly expiresAt: Date
  readonly isExpiring: boolean
}

/** Active reservations, soonest to expire first — the list a store keeper chases. */
export async function activeReservations(tx: Tx): Promise<ReservationRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        cr.id, cr.quantity_kg, cr.kesha_count, cr.status, cr.expires_at,
        s.code as section_code, rm.code as room_code,
        cu.legal_name as customer_name,
        dr.reference  as delivery_request_reference,
        (cr.expires_at < now() + interval '24 hours') as is_expiring
      from public.capacity_reservation cr
      join public.store_section s on s.id = cr.location_id
      join public.store_room rm   on rm.id = s.room_id
      join public.customer cu     on cu.id = cr.customer_id
      left join public.delivery_request dr on dr.id = cr.delivery_request_id
      where cr.status = 'ACTIVE'
      order by cr.expires_at asc
      limit 100
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    sectionCode: col.text(row.section_code),
    roomCode: col.text(row.room_code),
    customerName: col.text(row.customer_name),
    deliveryRequestReference: col.textOrNull(row.delivery_request_reference),
    quantityKg: col.numeric(row.quantity_kg),
    keshaCount: col.int(row.kesha_count),
    status: col.text(row.status),
    expiresAt: col.date(row.expires_at),
    isExpiring: col.bool(row.is_expiring),
  }))
}

import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { Decimal } from '@core/units/decimal'
import { NotFoundError } from '@core/errors/app-error'
import { lockRoomCapacity } from '@db/helpers/locks'
import type { CapacityFigures } from '../domain/capacity'

/**
 * M12 capacity writes and the figures read that backs every check.
 *
 * `sectionFigures` reads `vw_section_capacity` (capacity, safe-fill, active reservations)
 * joined to `stock_balance` (what is physically there) — the same two sources
 * `warehouseTree` assembles for the occupancy screen, so the number a reservation is
 * checked against is the number the screen shows.
 */
export async function sectionFigures(tx: Tx, locationId: string): Promise<CapacityFigures> {
  const rows = await rawRows(
    tx,
    sql`
      select
        v.capacity_kg, v.capacity_kesha, v.safe_fill_pct,
        v.reserved_kg, v.reserved_kesha,
        coalesce(bal.on_hand_kg, 0)       as on_hand_kg,
        coalesce(bal.on_hand_kesha, 0)::int as on_hand_kesha
      from public.vw_section_capacity v
      left join lateral (
        select sum(b.quantity_kg) as on_hand_kg, sum(b.kesha_count) as on_hand_kesha
        from public.stock_balance b
        where b.location_id = v.location_id and b.quantity_kg > 0
      ) bal on true
      where v.location_id = ${locationId}::uuid
    `,
  )

  const row = rows[0]
  if (!row) throw NotFoundError.of('Store section', locationId)

  return {
    capacityKg: Weight.fromKg(col.numeric(row.capacity_kg)),
    capacityKesha: KeshaCount.from(col.int(row.capacity_kesha)),
    occupiedKg: Weight.fromKg(col.numeric(row.on_hand_kg)),
    occupiedKesha: KeshaCount.from(col.int(row.on_hand_kesha)),
    reservedKg: Weight.fromKg(col.numeric(row.reserved_kg)),
    reservedKesha: KeshaCount.from(col.int(row.reserved_kesha)),
    safeFillPct: Decimal.parse(col.numeric(row.safe_fill_pct), 3),
  }
}

export interface ReserveCapacityInput {
  readonly locationId: string
  readonly deliveryRequestId: string
  readonly customerId: string
  readonly quantityKg: Weight
  readonly keshaCount: KeshaCount
  readonly expiresAt: Date
  readonly actorId: string
}

/**
 * Reserve space, under the room-level advisory lock.
 *
 * The lock — not the row itself — is what makes two concurrent approvals for the same room
 * serialise. Without it, two transactions can both read "80 kg free", both decide a 60 kg
 * request fits, and both insert a reservation: the check-then-act race the whole M12 design
 * exists to close. Callers re-run `sectionFigures`/`checkFit` AFTER acquiring the lock, not
 * before — the caller is expected to pass a figure obtained under the lock via
 * `sectionFigures`, so this function itself does not re-check; it only records.
 */
export async function reserveCapacity(tx: Tx, input: ReserveCapacityInput): Promise<string> {
  await lockRoomCapacity(tx, input.locationId)

  const id = uuidv7()
  await tx.execute(sql`
    insert into public.capacity_reservation (
      id, location_id, delivery_request_id, customer_id, quantity_kg, kesha_count,
      status, expires_at, created_by, created_at, updated_at
    ) values (
      ${id}, ${input.locationId}::uuid, ${input.deliveryRequestId}::uuid, ${input.customerId}::uuid,
      ${input.quantityKg.toKgString()}::numeric, ${input.keshaCount.toNumber()},
      'ACTIVE', ${input.expiresAt}, ${input.actorId}::uuid, now(), now()
    )
  `)
  return id
}

export async function findActiveReservationForRequest(
  tx: Tx,
  deliveryRequestId: string,
): Promise<{ id: string; locationId: string } | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select id, location_id from public.capacity_reservation
      where delivery_request_id = ${deliveryRequestId}::uuid and status = 'ACTIVE'
      limit 1
    `,
  )
  const row = rows[0]
  return row ? { id: col.text(row.id), locationId: col.text(row.location_id) } : undefined
}

export async function consumeReservation(tx: Tx, deliveryRequestId: string): Promise<void> {
  await tx.execute(sql`
    update public.capacity_reservation
    set status = 'CONSUMED', consumed_at = now(), updated_at = now()
    where delivery_request_id = ${deliveryRequestId}::uuid and status = 'ACTIVE'
  `)
}

export async function releaseReservation(
  tx: Tx,
  deliveryRequestId: string,
  reason: string,
): Promise<void> {
  await tx.execute(sql`
    update public.capacity_reservation
    set status = 'RELEASED', released_at = now(), released_reason = ${reason}, updated_at = now()
    where delivery_request_id = ${deliveryRequestId}::uuid and status = 'ACTIVE'
  `)
}

/** Sweep expired reservations. Returns how many were released, for the worker's log. */
export async function expireReservations(tx: Tx): Promise<number> {
  const rows = await rawRows(
    tx,
    sql`
      update public.capacity_reservation
      set status = 'EXPIRED', updated_at = now()
      where status = 'ACTIVE' and expires_at <= now()
      returning id
    `,
  )
  return rows.length
}

import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

export interface StorableLot {
  readonly lotId: string
  readonly customerId: string
  readonly branchId: string
  readonly storageStartDate: string
  /** Current on-hand balance, summed across every location the lot sits in. */
  readonly quantityKg: string
  /** The day after the last span already charged, or null if never charged. */
  readonly lastChargedToDate: string | null
}

/**
 * Every lot still in store with a storage-start date and a positive balance — the M20 sweep
 * population. `stock_balance` (not `lot.initial_quantity_kg`) is the current-quantity source
 * because a lot may have been partially dispatched.
 */
export async function lotsInStore(tx: Tx): Promise<StorableLot[]> {
  const rows = await rawRows(
    tx,
    sql`
      select l.id as lot_id, l.customer_id, c.branch_id, l.storage_start_date,
             coalesce(sb.total_kg, 0) as quantity_kg,
             sc.last_to_date
      from public.lot l
      join public.consignment c on c.id = l.consignment_id
      join (
        select lot_id, sum(quantity_kg) as total_kg
        from public.stock_balance
        group by lot_id
        having sum(quantity_kg) > 0
      ) sb on sb.lot_id = l.id
      left join (
        select lot_id, max(to_date) as last_to_date
        from public.storage_charge
        group by lot_id
      ) sc on sc.lot_id = l.id
      where l.status = 'IN_STORE' and l.storage_start_date is not null
    `,
  )
  return rows.map((row) => ({
    lotId: col.text(row.lot_id),
    customerId: col.text(row.customer_id),
    branchId: col.text(row.branch_id),
    storageStartDate: col.text(row.storage_start_date),
    quantityKg: col.numeric(row.quantity_kg),
    lastChargedToDate: col.textOrNull(row.last_to_date),
  }))
}

export interface InsertStorageChargeInput {
  readonly lotId: string
  readonly customerId: string
  readonly fromDate: string
  readonly toDate: string
  readonly daysCharged: number
  readonly quantityKg: string
  readonly ratePerKgPerDay: string
  readonly amount: string
  readonly chargeEventId: string
  readonly actorId: string
}

export async function insertStorageCharge(
  tx: Tx,
  input: InsertStorageChargeInput,
): Promise<string> {
  const id = uuidv7()
  await tx.execute(sql`
    insert into public.storage_charge (
      id, lot_id, customer_id, from_date, to_date, days_charged, quantity_kg,
      rate_per_kg_per_day, amount, charge_event_id, created_at, created_by
    ) values (
      ${id}::uuid, ${input.lotId}::uuid, ${input.customerId}::uuid, ${input.fromDate}::date,
      ${input.toDate}::date, ${input.daysCharged}, ${input.quantityKg}::numeric,
      ${input.ratePerKgPerDay}::numeric, ${input.amount}::numeric, ${input.chargeEventId}::uuid,
      now(), ${input.actorId}::uuid
    )
    on conflict on constraint uq_storage_charge__lot_span do nothing
  `)
  return id
}

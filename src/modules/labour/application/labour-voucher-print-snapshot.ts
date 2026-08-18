import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot for a Labour Payment Voucher (M06 §7.1, M18).
 *
 * `labour_output` has no separate "voucher" row: one call to `recordCrewOutput` inserts one
 * output row PER worker, all sharing the same crew, job order, activity and day — that shared
 * key IS the voucher. The loader is keyed on any one output id in the group (the row the
 * printing screen was opened from) and reassembles the rest of the group from it, so a
 * printed voucher always lists every worker who was paid out of the same confirmed count.
 *
 * Assembled once, at print time, and stored verbatim in `printed_document.printed_snapshot` —
 * a later correction to an output row must not silently change what a voucher that already
 * left the building says.
 */

export interface LabourVoucherWorkerLine {
  readonly workerId: string
  readonly workerCode: string
  readonly workerName: string
  readonly keshaCount: number | null
  readonly quantityKg: string | null
  readonly amount: string
}

export interface LabourVoucherSnapshot {
  readonly anchorOutputId: string
  readonly crewId: string | null
  readonly crewName: string | null
  readonly jobOrderId: string | null
  readonly jobOrderReference: string | null
  readonly consignmentId: string | null
  readonly consignmentReference: string | null
  readonly activityTypeName: string
  readonly producedOn: string
  readonly rateBasis: string | null
  readonly rateAmount: string | null
  readonly currency: string
  readonly confirmedKeshaCount: number | null
  readonly totalQuantityKg: string | null
  readonly totalAmount: string
  readonly workers: readonly LabourVoucherWorkerLine[]
}

export async function loadLabourVoucherSnapshot(
  tx: Tx,
  labourOutputId: string,
): Promise<LabourVoucherSnapshot | undefined> {
  const headerRows = await rawRows(
    tx,
    sql`
      select
        o.id, o.crew_id, c.name as crew_name,
        o.job_order_id, j.reference as job_order_reference, j.consignment_id,
        cons.reference as consignment_reference,
        o.activity_type_id, at.name_en as activity_type_name,
        o.produced_on, o.rate_basis, o.rate_amount, o.currency
      from public.labour_output o
      join public.labour_activity_type at on at.id = o.activity_type_id
      left join public.labour_crew c on c.id = o.crew_id
      left join public.job_order j on j.id = o.job_order_id
      left join public.consignment cons on cons.id = j.consignment_id
      where o.id = ${labourOutputId}::uuid
      limit 1
    `,
  )

  const header = headerRows[0]
  if (!header) return undefined

  const crewId = col.textOrNull(header.crew_id)
  const jobOrderId = col.textOrNull(header.job_order_id)
  const activityTypeId = col.text(header.activity_type_id)
  const producedOn = col.text(header.produced_on)

  const workerRows = await rawRows(
    tx,
    sql`
      select
        o.kesha_count, o.quantity_kg, o.calculated_amount,
        w.id as worker_id, w.worker_code, w.full_name as worker_name
      from public.labour_output o
      join public.labour_worker w on w.id = o.worker_id
      where o.activity_type_id = ${activityTypeId}::uuid
        and o.produced_on = ${producedOn}::date
        and o.status in ('APPROVED','PAID')
        ${crewId ? sql`and o.crew_id = ${crewId}::uuid` : sql`and o.crew_id is null`}
        ${jobOrderId ? sql`and o.job_order_id = ${jobOrderId}::uuid` : sql`and o.job_order_id is null`}
      order by w.full_name
    `,
  )

  const workers: LabourVoucherWorkerLine[] = workerRows.map((row) => ({
    workerId: col.text(row.worker_id),
    workerCode: col.text(row.worker_code),
    workerName: col.text(row.worker_name),
    keshaCount: col.intOrNull(row.kesha_count),
    quantityKg: col.numericOrNull(row.quantity_kg),
    amount: col.numeric(row.calculated_amount),
  }))

  const confirmedKeshaCount = workers.reduce<number | null>((sum, w) => {
    if (w.keshaCount === null) return sum
    return (sum ?? 0) + w.keshaCount
  }, null)

  const totalQuantityKg = workers.reduce<number | null>((sum, w) => {
    if (w.quantityKg === null) return sum
    return (sum ?? 0) + Number(w.quantityKg)
  }, null)

  const totalAmount = workers.reduce((sum, w) => sum + Number(w.amount), 0).toFixed(2)

  return {
    anchorOutputId: col.text(header.id),
    crewId,
    crewName: col.textOrNull(header.crew_name),
    jobOrderId,
    jobOrderReference: col.textOrNull(header.job_order_reference),
    consignmentId: col.textOrNull(header.consignment_id),
    consignmentReference: col.textOrNull(header.consignment_reference),
    activityTypeName: col.text(header.activity_type_name),
    producedOn,
    rateBasis: col.textOrNull(header.rate_basis),
    rateAmount: col.numericOrNull(header.rate_amount),
    currency: col.text(header.currency ?? 'ETB'),
    confirmedKeshaCount,
    totalQuantityKg: totalQuantityKg === null ? null : totalQuantityKg.toFixed(3),
    totalAmount,
    workers,
  }
}

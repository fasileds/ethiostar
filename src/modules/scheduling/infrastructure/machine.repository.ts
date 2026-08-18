import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

export interface MachineRow {
  readonly id: string
  readonly branchId: string
  readonly name: string
  readonly ratedCapacityKgPerHour: string
  readonly efficiencyFactor: string
  readonly status: string
}

export async function findMachine(tx: Tx, id: string): Promise<MachineRow | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select id, branch_id, name_en, rated_capacity_kg_per_hour, efficiency_factor, status
      from public.machine where id = ${id}::uuid
    `,
  )
  const row = rows[0]
  if (!row) return undefined
  return {
    id: col.text(row.id),
    branchId: col.text(row.branch_id),
    name: col.text(row.name_en),
    ratedCapacityKgPerHour: col.numeric(row.rated_capacity_kg_per_hour),
    efficiencyFactor: col.numeric(row.efficiency_factor),
    status: col.text(row.status),
  }
}

/** Next free sequence number for a machine-day — appointments are ordered within it. */
export async function nextSequenceNo(
  tx: Tx,
  machineId: string,
  scheduledOn: string,
): Promise<number> {
  const rows = await rawRows(
    tx,
    sql`
      select coalesce(max(sequence_no), 0) + 1 as next
      from public.appointment
      where machine_id = ${machineId}::uuid and scheduled_on = ${scheduledOn}::date
        and status not in ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
    `,
  )
  return rows[0] ? col.int(rows[0].next) : 1
}

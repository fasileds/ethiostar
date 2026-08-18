import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

/**
 * Admin CRUD for machines — the sorters, hullers, graders, cleaners and polishers that the
 * scheduler books capacity against. Read access for scheduling itself is `schedule.query.ts`
 * (`listMachines`, active only); this file is the write side, used only by the admin screen,
 * and its listing includes inactive machines too so they can be seen and reactivated.
 *
 * `machine_capacity_day` (per-machine, per-date overrides — maintenance days, holidays, extra
 * shifts) is routine day-to-day data entry rather than master data, and is not exposed here.
 */

export const MACHINE_TYPES = ['SORTER', 'HULLER', 'GRADER', 'CLEANER', 'POLISHER'] as const
export const MACHINE_STATUSES = [
  'AVAILABLE',
  'RUNNING',
  'MAINTENANCE',
  'BREAKDOWN',
  'RETIRED',
] as const

export interface MachineAdminRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly machineType: string
  readonly ratedCapacityKgPerHour: string
  readonly efficiencyFactor: string
  readonly status: string
  readonly isActive: boolean
}

export async function listAllMachines(tx: Tx): Promise<MachineAdminRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, name_en, machine_type, rated_capacity_kg_per_hour, efficiency_factor,
             status, is_active
      from public.machine
      order by code
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name_en),
    machineType: col.text(row.machine_type),
    ratedCapacityKgPerHour: col.numeric(row.rated_capacity_kg_per_hour),
    efficiencyFactor: col.numeric(row.efficiency_factor),
    status: col.text(row.status),
    isActive: col.bool(row.is_active),
  }))
}

/** Phase 1 is single-branch — the admin form has no branch picker, so the new machine is
 *  attached to whichever branch was seeded first. */
async function defaultBranchId(tx: Tx): Promise<string> {
  const rows = await rawRows(tx, sql`select id from public.branch order by created_at limit 1`)
  const row = rows[0]
  if (!row) throw new Error('No branch is set up yet.')
  return col.text(row.id)
}

export interface CreateMachineInput {
  readonly code: string
  readonly nameEn: string
  readonly machineType: string
  readonly ratedCapacityKgPerHour: string
  readonly efficiencyFactor: string
  readonly actorId: string
}

export async function createMachine(tx: Tx, input: CreateMachineInput): Promise<void> {
  const branchId = await defaultBranchId(tx)
  await tx.execute(sql`
    insert into public.machine (
      id, branch_id, code, name_en, machine_type,
      rated_capacity_kg_per_hour, efficiency_factor, status, is_active,
      created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${branchId}::uuid, ${input.code}, ${input.nameEn}, ${input.machineType},
      ${input.ratedCapacityKgPerHour}, ${input.efficiencyFactor}, 'AVAILABLE', true,
      ${input.actorId}::uuid, now(), now()
    )
  `)
}

export async function setMachineStatus(
  tx: Tx,
  id: string,
  status: string,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.machine
    set status = ${status}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}

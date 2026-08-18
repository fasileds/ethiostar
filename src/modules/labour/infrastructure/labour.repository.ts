import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { Money } from '@core/units/money'
import { Decimal } from '@core/units/decimal'
import { NotFoundError } from '@core/errors/app-error'
import type { PieceRateVersion } from '../domain/piece-rate'

export interface CreateWorkerInput {
  readonly branchId: string
  readonly workerCode: string
  readonly fullName: string
  readonly phone: string | null
  readonly defaultActivityTypeId: string | null
  readonly engagedOn: string
  readonly actorId: string
}

export async function insertWorker(tx: Tx, input: CreateWorkerInput): Promise<string> {
  const id = uuidv7()
  await tx.execute(sql`
    insert into public.labour_worker (
      id, branch_id, worker_code, full_name, phone, default_activity_type_id, engaged_on,
      is_active, created_by, created_at, updated_at
    ) values (
      ${id}, ${input.branchId}::uuid, ${input.workerCode}, ${input.fullName}, ${input.phone},
      ${input.defaultActivityTypeId}::uuid, ${input.engagedOn}::date, true,
      ${input.actorId}::uuid, now(), now()
    )
  `)
  return id
}

export async function insertCrew(
  tx: Tx,
  branchId: string,
  code: string,
  name: string,
  supervisorId: string | null,
  actorId: string,
): Promise<string> {
  const id = uuidv7()
  await tx.execute(sql`
    insert into public.labour_crew (id, branch_id, code, name, supervisor_id, is_active, created_by, created_at, updated_at)
    values (${id}, ${branchId}::uuid, ${code}, ${name}, ${supervisorId}::uuid, true, ${actorId}::uuid, now(), now())
  `)
  return id
}

export async function addCrewMember(
  tx: Tx,
  crewId: string,
  workerId: string,
  joinedOn: string,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into public.labour_crew_member (id, crew_id, worker_id, joined_on, created_by, created_at, updated_at)
    values (${uuidv7()}, ${crewId}::uuid, ${workerId}::uuid, ${joinedOn}::date, ${actorId}::uuid, now(), now())
  `)
}

export async function crewMemberIds(tx: Tx, crewId: string): Promise<string[]> {
  const rows = await rawRows(
    tx,
    sql`select worker_id from public.labour_crew_member where crew_id = ${crewId}::uuid and left_on is null`,
  )
  return rows.map((row) => col.text(row.worker_id))
}

/** The piece rate in force for an activity on a given date. */
export async function findActiveRate(
  tx: Tx,
  activityTypeId: string,
  branchId: string,
  on: string,
): Promise<PieceRateVersion> {
  const rows = await rawRows(
    tx,
    sql`
      select id, rate_amount, currency
      from public.labour_rate
      where activity_type_id = ${activityTypeId}::uuid and branch_id = ${branchId}::uuid
        and effective_from <= ${on}::date and (effective_to is null or effective_to >= ${on}::date)
      order by effective_from desc
      limit 1
    `,
  )
  const row = rows[0]
  if (!row) throw NotFoundError.of('Piece rate', `${activityTypeId} @ ${branchId} on ${on}`)

  return {
    id: col.text(row.id),
    amountPerKesha: Money.parse(col.numeric(row.rate_amount), col.text(row.currency)),
    // ⚠️ Multiplier columns are not yet on `labour_rate` — Decision #5 (piece rates per
    // activity/weight class/shift, including premiums) is still owed by EthioStar per
    // docs/phase-1/STATUS.md. 1.000 (no premium) until that schema addition lands.
    overtimeMultiplier: Decimal.parse('1.000', 3),
    nightMultiplier: Decimal.parse('1.000', 3),
    holidayMultiplier: Decimal.parse('1.000', 3),
  }
}

export interface InsertLabourOutputInput {
  readonly workerId: string
  readonly crewId: string
  readonly jobOrderId: string | null
  readonly activityTypeId: string
  readonly producedOn: string
  readonly keshaCount: number
  readonly rateId: string
  readonly rateAmount: string
  readonly calculatedAmount: string
  readonly currency: string
  readonly recordedBy: string
}

export async function insertLabourOutput(
  tx: Tx,
  input: InsertLabourOutputInput,
): Promise<string> {
  const id = uuidv7()
  await tx.execute(sql`
    insert into public.labour_output (
      id, worker_id, crew_id, job_order_id, activity_type_id, produced_on,
      kesha_count, rate_id, rate_basis, rate_amount, calculated_amount, currency,
      status, recorded_by, created_by, created_at, updated_at
    ) values (
      ${id}, ${input.workerId}::uuid, ${input.crewId}::uuid, ${input.jobOrderId}::uuid,
      ${input.activityTypeId}::uuid, ${input.producedOn}::date,
      ${input.keshaCount}, ${input.rateId}::uuid, 'PER_KESHA',
      ${input.rateAmount}::numeric, ${input.calculatedAmount}::numeric, ${input.currency},
      'RECORDED', ${input.recordedBy}::uuid, ${input.recordedBy}::uuid, now(), now()
    )
  `)
  return id
}

export async function approveLabourOutputRow(
  tx: Tx,
  id: string,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.labour_output
    set status = 'APPROVED', approved_by = ${actorId}::uuid, approved_at = now(),
        updated_at = now(), version = version + 1
    where id = ${id}::uuid and status = 'RECORDED'
  `)
}

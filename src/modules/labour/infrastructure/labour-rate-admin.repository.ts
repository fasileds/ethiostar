import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import type { BusinessDate } from '@core/utils/date'
import { assertNoOverlap, type EffectiveDated } from '@modules/master-data'

/**
 * Admin CRUD for labour piece rates (M18). A rate is identified by
 * (branch, activity type, rate basis) and is EFFECTIVE-DATED within that key: a rate change
 * must never restate what a worker already earned, so the write action is always "add a new
 * version" — closing out whichever version of the same key is still open-ended — never an
 * in-place edit of a historical rate.
 */

export interface LabourRateRow {
  readonly id: string
  readonly branchId: string
  readonly branchName: string
  readonly activityTypeId: string
  readonly activityName: string
  readonly rateBasis: string
  readonly rateAmount: string
  readonly currency: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

/** All labour rates, most recent effective date first — for the admin list screen. */
export async function listLabourRates(tx: Tx): Promise<LabourRateRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select r.id, r.branch_id, b.name_en as branch_name, r.activity_type_id,
             a.name_en as activity_name, r.rate_basis, r.rate_amount, r.currency,
             r.effective_from, r.effective_to
      from public.labour_rate r
      join public.branch b on b.id = r.branch_id
      join public.labour_activity_type a on a.id = r.activity_type_id
      order by r.effective_from desc
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    branchId: col.text(row.branch_id),
    branchName: col.text(row.branch_name),
    activityTypeId: col.text(row.activity_type_id),
    activityName: col.text(row.activity_name),
    rateBasis: col.text(row.rate_basis),
    rateAmount: col.numeric(row.rate_amount),
    currency: col.text(row.currency),
    effectiveFrom: col.text(row.effective_from),
    effectiveTo: col.textOrNull(row.effective_to),
  }))
}

/** Every rate sharing one (branch, activity, basis) key, oldest first — for overlap validation. */
export async function listRatesForKey(
  tx: Tx,
  branchId: string,
  activityTypeId: string,
  rateBasis: string,
): Promise<LabourRateRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select r.id, r.branch_id, b.name_en as branch_name, r.activity_type_id,
             a.name_en as activity_name, r.rate_basis, r.rate_amount, r.currency,
             r.effective_from, r.effective_to
      from public.labour_rate r
      join public.branch b on b.id = r.branch_id
      join public.labour_activity_type a on a.id = r.activity_type_id
      where r.branch_id = ${branchId}::uuid and r.activity_type_id = ${activityTypeId}::uuid
        and r.rate_basis = ${rateBasis}
      order by r.effective_from asc
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    branchId: col.text(row.branch_id),
    branchName: col.text(row.branch_name),
    activityTypeId: col.text(row.activity_type_id),
    activityName: col.text(row.activity_name),
    rateBasis: col.text(row.rate_basis),
    rateAmount: col.numeric(row.rate_amount),
    currency: col.text(row.currency),
    effectiveFrom: col.text(row.effective_from),
    effectiveTo: col.textOrNull(row.effective_to),
  }))
}

export interface AddLabourRateInput {
  readonly branchId: string
  readonly activityTypeId: string
  readonly rateBasis: 'PER_KG' | 'PER_KESHA' | 'PER_DAY' | 'PER_HOUR'
  readonly rateAmount: string
  readonly currency: string
  readonly effectiveFrom: BusinessDate
  readonly actorId: string
}

/**
 * Add a new rate version. Closes whichever existing version of the same
 * (branch, activity, basis) key is still open-ended, the day before the new one starts, then
 * inserts the new open-ended version. `assertNoOverlap` is checked against the post-close
 * state before either write runs, mirroring the database check constraint that is the real
 * authority.
 */
export async function addLabourRate(tx: Tx, input: AddLabourRateInput): Promise<void> {
  const existing = await listRatesForKey(
    tx,
    input.branchId,
    input.activityTypeId,
    input.rateBasis,
  )

  const openEnded = existing.find((v) => v.effectiveTo === null)
  const dayBefore = new Date(Date.parse(`${input.effectiveFrom}T00:00:00.000Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10) as BusinessDate

  const effectiveSet: EffectiveDated[] = existing.map((v) =>
    openEnded && v.id === openEnded.id
      ? { id: v.id, effectiveFrom: v.effectiveFrom as BusinessDate, effectiveTo: dayBefore }
      : {
          id: v.id,
          effectiveFrom: v.effectiveFrom as BusinessDate,
          effectiveTo: v.effectiveTo as BusinessDate | null,
        },
  )

  assertNoOverlap(effectiveSet, { effectiveFrom: input.effectiveFrom, effectiveTo: null })

  if (openEnded) {
    await tx.execute(sql`
      update public.labour_rate
      set effective_to = ${dayBefore}::date, updated_at = now(), updated_by = ${input.actorId}::uuid,
          version = version + 1
      where id = ${openEnded.id}::uuid
    `)
  }

  await tx.execute(sql`
    insert into public.labour_rate (
      id, branch_id, activity_type_id, rate_basis, rate_amount, currency,
      effective_from, effective_to, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.branchId}::uuid, ${input.activityTypeId}::uuid, ${input.rateBasis},
      ${input.rateAmount}::numeric, ${input.currency}, ${input.effectiveFrom}::date, null,
      ${input.actorId}::uuid, now(), now()
    )
  `)
}

export interface LabourActivityTypeOption {
  readonly id: string
  readonly code: string
  readonly name: string
}

/** Active activity types, for the rate form's dropdown. */
export async function listLabourActivityTypes(tx: Tx): Promise<LabourActivityTypeOption[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, name_en
      from public.labour_activity_type
      where is_active
      order by sort_order, name_en
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    name: col.text(row.name_en),
  }))
}

export interface BranchOption {
  readonly id: string
  readonly code: string
  readonly name: string
}

/** Active branches, for the rate form's dropdown. */
export async function listBranchesForLabourRate(tx: Tx): Promise<BranchOption[]> {
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

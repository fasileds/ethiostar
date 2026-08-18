import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

export interface StorageRateTierRow {
  readonly id: string
  readonly branchId: string
  readonly branchName: string
  readonly fromDay: number
  readonly ratePerKgPerDay: string
  readonly currency: string
  readonly isActive: boolean
}

export async function listStorageRateTiers(tx: Tx): Promise<StorageRateTierRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select t.id, t.branch_id, b.name_en as branch_name, t.from_day, t.rate_per_kg_per_day,
             t.currency, t.is_active
      from public.storage_rate_tier t
      join public.branch b on b.id = t.branch_id
      order by b.name_en, t.from_day
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    branchId: col.text(row.branch_id),
    branchName: col.text(row.branch_name),
    fromDay: col.int(row.from_day),
    ratePerKgPerDay: col.numeric(row.rate_per_kg_per_day),
    currency: col.text(row.currency),
    isActive: col.bool(row.is_active),
  }))
}

/** Active tiers for a branch, ascending by threshold — for resolving which tier applies. */
export async function activeTiersForBranch(
  tx: Tx,
  branchId: string,
): Promise<StorageRateTierRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select t.id, t.branch_id, b.name_en as branch_name, t.from_day, t.rate_per_kg_per_day,
             t.currency, t.is_active
      from public.storage_rate_tier t
      join public.branch b on b.id = t.branch_id
      where t.branch_id = ${branchId}::uuid and t.is_active
      order by t.from_day asc
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    branchId: col.text(row.branch_id),
    branchName: col.text(row.branch_name),
    fromDay: col.int(row.from_day),
    ratePerKgPerDay: col.numeric(row.rate_per_kg_per_day),
    currency: col.text(row.currency),
    isActive: col.bool(row.is_active),
  }))
}

export interface AddStorageRateTierInput {
  readonly branchId: string
  readonly fromDay: number
  readonly ratePerKgPerDay: string
  readonly currency: string
  readonly actorId: string
}

export async function addStorageRateTier(
  tx: Tx,
  input: AddStorageRateTierInput,
): Promise<string> {
  const id = uuidv7()
  await tx.execute(sql`
    insert into public.storage_rate_tier (
      id, branch_id, from_day, rate_per_kg_per_day, currency, is_active,
      created_at, created_by, updated_at
    ) values (
      ${id}::uuid, ${input.branchId}::uuid, ${input.fromDay}, ${input.ratePerKgPerDay}::numeric,
      ${input.currency}, true, now(), ${input.actorId}::uuid, now()
    )
  `)
  return id
}

export async function setStorageRateTierActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.storage_rate_tier
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${id}::uuid
  `)
}

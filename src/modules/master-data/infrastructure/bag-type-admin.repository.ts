import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import type { BusinessDate } from '@core/utils/date'
import { assertNoOverlap, type EffectiveDated } from '../domain/effective-version'

/**
 * Admin CRUD for bag types (M02). The type itself (`bag_type`) is a stable identity — code,
 * name, ownership. Its standard weight is EFFECTIVE-DATED in `bag_type_version`: changing a
 * tare weight must not retrospectively alter a receipt already reconciled under the old one,
 * so the write action is always "add a new version", never "edit the weight in place".
 */

export interface BagTypeVersionRow {
  readonly id: string
  readonly bagTypeId: string
  readonly standardNetWeightKg: string
  readonly tareWeightKg: string | null
  readonly weightTolerancePct: string | null
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
}

export interface BagTypeRow {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly material: string | null
  readonly ownership: string
  readonly isReturnable: boolean
  readonly isActive: boolean
  readonly currentVersion: BagTypeVersionRow | null
}

/**
 * All bag types with every version (oldest first), so the client can show history and the
 * server can validate a new version against the full set — `assertNoOverlap` needs it all,
 * not just the current one.
 */
export async function listBagTypesWithVersions(tx: Tx): Promise<BagTypeRow[]> {
  const typeRows = await rawRows(
    tx,
    sql`
      select id, code, name_en, material, ownership, is_returnable, is_active
      from public.bag_type
      order by name_en
    `,
  )

  const versionRows = await rawRows(
    tx,
    sql`
      select id, bag_type_id, standard_net_weight_kg, tare_weight_kg, weight_tolerance_pct,
             effective_from, effective_to
      from public.bag_type_version
      order by effective_from desc
    `,
  )

  const versionsByType = new Map<string, BagTypeVersionRow[]>()
  for (const row of versionRows) {
    const version: BagTypeVersionRow = {
      id: col.text(row.id),
      bagTypeId: col.text(row.bag_type_id),
      standardNetWeightKg: col.numeric(row.standard_net_weight_kg),
      tareWeightKg: col.numericOrNull(row.tare_weight_kg),
      weightTolerancePct: col.numericOrNull(row.weight_tolerance_pct),
      effectiveFrom: col.text(row.effective_from),
      effectiveTo: col.textOrNull(row.effective_to),
    }
    const group = versionsByType.get(version.bagTypeId) ?? []
    group.push(version)
    versionsByType.set(version.bagTypeId, group)
  }

  return typeRows.map((row) => {
    const id = col.text(row.id)
    const versions = versionsByType.get(id) ?? []
    // Versions are ordered effective_from desc, so the open-ended or latest one is first.
    const currentVersion = versions.find((v) => v.effectiveTo === null) ?? versions[0] ?? null

    return {
      id,
      code: col.text(row.code),
      name: col.text(row.name_en),
      material: col.textOrNull(row.material),
      ownership: col.text(row.ownership),
      isReturnable: col.bool(row.is_returnable),
      isActive: col.bool(row.is_active),
      currentVersion,
    }
  })
}

/** Every version of one bag type, oldest first — used to validate a proposed new version. */
export async function listVersionsForBagType(
  tx: Tx,
  bagTypeId: string,
): Promise<BagTypeVersionRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, bag_type_id, standard_net_weight_kg, tare_weight_kg, weight_tolerance_pct,
             effective_from, effective_to
      from public.bag_type_version
      where bag_type_id = ${bagTypeId}::uuid
      order by effective_from asc
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    bagTypeId: col.text(row.bag_type_id),
    standardNetWeightKg: col.numeric(row.standard_net_weight_kg),
    tareWeightKg: col.numericOrNull(row.tare_weight_kg),
    weightTolerancePct: col.numericOrNull(row.weight_tolerance_pct),
    effectiveFrom: col.text(row.effective_from),
    effectiveTo: col.textOrNull(row.effective_to),
  }))
}

export interface CreateBagTypeInput {
  readonly code: string
  readonly nameEn: string
  readonly material: string | null
  readonly ownership: 'ETHIOSTAR' | 'CUSTOMER'
  readonly isReturnable: boolean
  readonly standardNetWeightKg: string
  readonly tareWeightKg: string | null
  readonly weightTolerancePct: string | null
  readonly effectiveFrom: BusinessDate
  readonly actorId: string
}

/**
 * A brand-new bag type needs both a `bag_type` row and its first `bag_type_version` row,
 * created together — a type with no version is unusable, and a version with no type cannot
 * exist per the foreign key.
 */
export async function createBagType(tx: Tx, input: CreateBagTypeInput): Promise<void> {
  const bagTypeId = uuidv7()

  await tx.execute(sql`
    insert into public.bag_type (
      id, code, name_en, material, ownership, is_returnable, is_active,
      created_by, created_at, updated_at
    ) values (
      ${bagTypeId}, ${input.code}, ${input.nameEn}, ${input.material}, ${input.ownership},
      ${input.isReturnable}, true, ${input.actorId}::uuid, now(), now()
    )
  `)

  await tx.execute(sql`
    insert into public.bag_type_version (
      id, bag_type_id, standard_net_weight_kg, tare_weight_kg, weight_tolerance_pct,
      effective_from, effective_to, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${bagTypeId}::uuid, ${input.standardNetWeightKg}, ${input.tareWeightKg},
      ${input.weightTolerancePct}, ${input.effectiveFrom}::date, null,
      ${input.actorId}::uuid, now(), now()
    )
  `)
}

export interface AddBagTypeVersionInput {
  readonly bagTypeId: string
  readonly standardNetWeightKg: string
  readonly tareWeightKg: string | null
  readonly weightTolerancePct: string | null
  readonly effectiveFrom: BusinessDate
  readonly actorId: string
}

/**
 * Add a new version. The usual shape: close whichever existing version is still open-ended by
 * setting its `effective_to` to the day before the new one starts, then insert the new
 * open-ended version. `assertNoOverlap` is checked against the post-close state before either
 * write runs, mirroring the SQL EXCLUDE constraint that is the real authority.
 */
export async function addBagTypeVersion(tx: Tx, input: AddBagTypeVersionInput): Promise<void> {
  const existing = await listVersionsForBagType(tx, input.bagTypeId)

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
      update public.bag_type_version
      set effective_to = ${dayBefore}::date, updated_at = now(), updated_by = ${input.actorId}::uuid,
          version = version + 1
      where id = ${openEnded.id}::uuid
    `)
  }

  await tx.execute(sql`
    insert into public.bag_type_version (
      id, bag_type_id, standard_net_weight_kg, tare_weight_kg, weight_tolerance_pct,
      effective_from, effective_to, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.bagTypeId}::uuid, ${input.standardNetWeightKg}, ${input.tareWeightKg},
      ${input.weightTolerancePct}, ${input.effectiveFrom}::date, null,
      ${input.actorId}::uuid, now(), now()
    )
  `)
}

export async function setBagTypeActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.bag_type
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}

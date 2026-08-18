import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import type { BusinessDate } from '@core/utils/date'
import { assertNoOverlap, type EffectiveDated } from '@modules/master-data'

/**
 * M10 tariff lines. Effective-dated within the (contract-or-null, branch, service_code) key
 * exactly like `bag_type_version` / `labour_rate` — see
 * `master-data/infrastructure/bag-type-admin.repository.ts` for the pattern this mirrors:
 * close the currently open-ended line for the key, then insert the new one.
 */

export interface TariffLineRow {
  readonly id: string
  readonly contractId: string | null
  readonly branchId: string
  readonly serviceCode: string
  readonly uom: string
  readonly rateAmount: string
  readonly currency: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly negotiationReason: string | null
}

const TARIFF_LINE_SELECT = sql`
  select id, contract_id, branch_id, service_code, uom, rate_amount, currency,
         effective_from, effective_to, negotiation_reason
  from public.tariff_line
`

function toTariffLineRow(row: Record<string, unknown>): TariffLineRow {
  return {
    id: col.text(row.id),
    contractId: col.textOrNull(row.contract_id),
    branchId: col.text(row.branch_id),
    serviceCode: col.text(row.service_code),
    uom: col.text(row.uom),
    rateAmount: col.numeric(row.rate_amount),
    currency: col.text(row.currency),
    effectiveFrom: col.text(row.effective_from),
    effectiveTo: col.textOrNull(row.effective_to),
    negotiationReason: col.textOrNull(row.negotiation_reason),
  }
}

/** Every line — negotiated and standard — for one branch + service, oldest first. Used to
 *  both resolve a rate (application layer) and to validate a new line against the full set. */
export async function listTariffLinesForBranchService(
  tx: Tx,
  branchId: string,
  serviceCode: string,
): Promise<TariffLineRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      ${TARIFF_LINE_SELECT}
      where branch_id = ${branchId}::uuid and service_code = ${serviceCode}
      order by effective_from asc
    `,
  )
  return rows.map(toTariffLineRow)
}

/** The branch standard tariff (contract_id is null), every service code, for admin display. */
export async function listStandardTariff(tx: Tx, branchId: string): Promise<TariffLineRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      ${TARIFF_LINE_SELECT}
      where branch_id = ${branchId}::uuid and contract_id is null
      order by service_code, effective_from desc
    `,
  )
  return rows.map(toTariffLineRow)
}

/** All negotiated lines on one contract, every service code, for the contract detail screen. */
export async function listContractTariff(tx: Tx, contractId: string): Promise<TariffLineRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      ${TARIFF_LINE_SELECT}
      where contract_id = ${contractId}::uuid
      order by service_code, effective_from desc
    `,
  )
  return rows.map(toTariffLineRow)
}

/** Every line sharing one (contract-or-null, branch, service) key, oldest first. */
async function listLinesForKey(
  tx: Tx,
  contractId: string | null,
  branchId: string,
  serviceCode: string,
): Promise<TariffLineRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      ${TARIFF_LINE_SELECT}
      where contract_id is not distinct from ${contractId}::uuid
        and branch_id = ${branchId}::uuid
        and service_code = ${serviceCode}
      order by effective_from asc
    `,
  )
  return rows.map(toTariffLineRow)
}

export interface AddTariffLineInput {
  readonly contractId: string | null
  readonly branchId: string
  readonly serviceCode: string
  readonly uom: 'PER_KG' | 'PER_KESHA' | 'PER_DAY' | 'FLAT'
  readonly rateAmount: string
  readonly currency: string
  readonly effectiveFrom: BusinessDate
  readonly negotiationReason: string | null
  readonly actorId: string
}

/**
 * Add a tariff line. Closes whichever existing line of the same key is still open-ended, the
 * day before the new one starts, then inserts the new open-ended line — `assertNoOverlap`
 * checked against the post-close state first, mirroring the CHECK constraint that is the
 * real authority.
 */
export async function addTariffLine(
  tx: Tx,
  input: AddTariffLineInput,
): Promise<{ id: string }> {
  const existing = await listLinesForKey(
    tx,
    input.contractId,
    input.branchId,
    input.serviceCode,
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
      update public.tariff_line
      set effective_to = ${dayBefore}::date, updated_at = now(), updated_by = ${input.actorId}::uuid,
          version = version + 1
      where id = ${openEnded.id}::uuid
    `)
  }

  const id = uuidv7()
  await tx.execute(sql`
    insert into public.tariff_line (
      id, contract_id, branch_id, service_code, uom, rate_amount, currency,
      effective_from, effective_to, negotiation_reason,
      created_by, created_at, updated_at
    ) values (
      ${id}, ${input.contractId}::uuid, ${input.branchId}::uuid, ${input.serviceCode}, ${input.uom},
      ${input.rateAmount}::numeric, ${input.currency}, ${input.effectiveFrom}::date, null,
      ${input.negotiationReason},
      ${input.actorId}::uuid, now(), now()
    )
  `)

  return { id }
}

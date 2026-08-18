import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import type { BusinessDate } from '@core/utils/date'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { NotFoundError, InvalidStateTransitionError } from '@core/errors/app-error'

/**
 * M10 — the contract header. `reference` is a CTR-prefixed number allocated the same
 * gapless way as every other Phase 1 document (`allocateDocumentNumber`).
 */

export interface ContractRow {
  readonly id: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchId: string
  readonly branchName: string
  readonly status: string
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly freeStorageDays: number
  readonly paymentTermsDays: number
  readonly creditLimitAmount: string | null
  readonly currency: string
  readonly notes: string | null
  readonly terminatedAt: Date | null
  readonly terminatedReason: string | null
  readonly createdAt: Date
}

const CONTRACT_SELECT = sql`
  select c.id, c.reference, c.customer_id, cust.legal_name as customer_name,
         c.branch_id, b.name_en as branch_name, c.status,
         c.effective_from, c.effective_to, c.free_storage_days, c.payment_terms_days,
         c.credit_limit_amount, c.currency, c.notes, c.terminated_at, c.terminated_reason,
         c.created_at
  from public.contract c
  join public.customer cust on cust.id = c.customer_id
  join public.branch b on b.id = c.branch_id
`

function toContractRow(row: Record<string, unknown>): ContractRow {
  return {
    id: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    branchId: col.text(row.branch_id),
    branchName: col.text(row.branch_name),
    status: col.text(row.status),
    effectiveFrom: col.text(row.effective_from),
    effectiveTo: col.textOrNull(row.effective_to),
    freeStorageDays: col.int(row.free_storage_days),
    paymentTermsDays: col.int(row.payment_terms_days),
    creditLimitAmount: col.numericOrNull(row.credit_limit_amount),
    currency: col.text(row.currency),
    notes: col.textOrNull(row.notes),
    terminatedAt: col.dateOrNull(row.terminated_at),
    terminatedReason: col.textOrNull(row.terminated_reason),
    createdAt: col.date(row.created_at),
  }
}

export async function listContractsAdmin(tx: Tx): Promise<ContractRow[]> {
  const rows = await rawRows(tx, sql`${CONTRACT_SELECT} order by c.created_at desc`)
  return rows.map(toContractRow)
}

export async function listContractsForCustomer(
  tx: Tx,
  customerId: string,
): Promise<ContractRow[]> {
  const rows = await rawRows(
    tx,
    sql`${CONTRACT_SELECT} where c.customer_id = ${customerId}::uuid order by c.effective_from desc`,
  )
  return rows.map(toContractRow)
}

export async function findContract(tx: Tx, id: string): Promise<ContractRow | null> {
  const rows = await rawRows(tx, sql`${CONTRACT_SELECT} where c.id = ${id}::uuid`)
  return rows[0] ? toContractRow(rows[0]) : null
}

/** Every ACTIVE contract for the customer whose effective period covers `asOfDate`. */
export async function findActiveContractAsOf(
  tx: Tx,
  customerId: string,
  branchId: string,
  asOfDate: BusinessDate,
): Promise<ContractRow | null> {
  const rows = await rawRows(
    tx,
    sql`
      ${CONTRACT_SELECT}
      where c.customer_id = ${customerId}::uuid
        and c.branch_id = ${branchId}::uuid
        and c.status = 'ACTIVE'
        and c.effective_from <= ${asOfDate}::date
        and (c.effective_to is null or c.effective_to >= ${asOfDate}::date)
      order by c.effective_from desc
      limit 1
    `,
  )
  return rows[0] ? toContractRow(rows[0]) : null
}

async function lockContract(tx: Tx, id: string): Promise<ContractRow> {
  const rows = await rawRows(
    tx,
    sql`${CONTRACT_SELECT} where c.id = ${id}::uuid for update of c`,
  )
  const row = rows[0]
  if (!row) throw NotFoundError.of('Contract', id)
  return toContractRow(row)
}

export interface CreateContractDraftInput {
  readonly customerId: string
  readonly branchId: string
  readonly effectiveFrom: BusinessDate
  readonly effectiveTo: BusinessDate | null
  readonly freeStorageDays: number
  readonly paymentTermsDays: number
  readonly creditLimitAmount: string | null
  readonly currency: string
  readonly notes: string | null
  readonly actorId: string
}

export async function createContractDraft(
  tx: Tx,
  input: CreateContractDraftInput,
): Promise<{ id: string; reference: string }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.CONTRACT, {
    branchId: input.branchId,
    actorId: input.actorId,
  })

  await tx.execute(sql`
    insert into public.contract (
      id, reference, customer_id, branch_id, status,
      effective_from, effective_to, free_storage_days, payment_terms_days,
      credit_limit_amount, currency, notes,
      created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.customerId}::uuid, ${input.branchId}::uuid, 'DRAFT',
      ${input.effectiveFrom}::date, ${input.effectiveTo}::date, ${input.freeStorageDays},
      ${input.paymentTermsDays}, ${input.creditLimitAmount}::numeric, ${input.currency},
      ${input.notes},
      ${input.actorId}::uuid, now(), now()
    )
  `)

  return { id, reference: allocated.formatted }
}

const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['EXPIRED', 'TERMINATED'],
  EXPIRED: [],
  TERMINATED: [],
}

/** DRAFT → ACTIVE. Locks the row first so two concurrent activations cannot both succeed. */
export async function activateContract(
  tx: Tx,
  id: string,
  actorId: string,
): Promise<ContractRow> {
  const contract = await lockContract(tx, id)
  if (!ALLOWED_TRANSITIONS[contract.status]?.includes('ACTIVE')) {
    throw new InvalidStateTransitionError(
      'contract',
      contract.status,
      'ACTIVE',
      ALLOWED_TRANSITIONS[contract.status] ?? [],
    )
  }

  await tx.execute(sql`
    update public.contract
    set status = 'ACTIVE', updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${id}::uuid
  `)

  return { ...contract, status: 'ACTIVE' }
}

export async function terminateContract(
  tx: Tx,
  id: string,
  reason: string,
  actorId: string,
): Promise<ContractRow> {
  const contract = await lockContract(tx, id)
  if (!ALLOWED_TRANSITIONS[contract.status]?.includes('TERMINATED')) {
    throw new InvalidStateTransitionError(
      'contract',
      contract.status,
      'TERMINATED',
      ALLOWED_TRANSITIONS[contract.status] ?? [],
    )
  }

  await tx.execute(sql`
    update public.contract
    set status = 'TERMINATED', terminated_at = now(), terminated_reason = ${reason},
        updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${id}::uuid
  `)

  return { ...contract, status: 'TERMINATED', terminatedReason: reason }
}

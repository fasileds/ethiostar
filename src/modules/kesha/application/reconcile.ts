import 'server-only'
import { sql } from 'drizzle-orm'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { KeshaCount } from '@core/units/kesha'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { keshaBalanceFor } from '../infrastructure/kesha.repository'

export interface StartReconciliationInput {
  readonly branchId: string
  readonly customerId: string
  readonly bagTypeId: string | null
  readonly countedOn: string
  readonly countedFull: number
  readonly countedEmpty: number
  readonly damagedFound: number
  readonly countedBy: string
}

export async function startKeshaReconciliation(
  claims: DbClaims,
  input: StartReconciliationInput,
): Promise<{ id: string; reference: string }> {
  return runInTransaction(claims, async (tx) => {
    const expected = await keshaBalanceFor(
      tx,
      input.customerId,
      input.bagTypeId,
      input.branchId,
    )
    const id = uuidv7()
    const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.STOCK_COUNT, {
      branchId: input.branchId,
      actorId: input.countedBy,
    })

    await tx.execute(sql`
      insert into public.kesha_reconciliation (
        id, reference, branch_id, customer_id, bag_type_id, counted_on, status,
        expected_full, expected_empty, counted_full, counted_empty, damaged_found,
        counted_by, created_by, created_at, updated_at
      ) values (
        ${id}, ${allocated.formatted}, ${input.branchId}::uuid, ${input.customerId}::uuid,
        ${input.bagTypeId}::uuid, ${input.countedOn}::date, 'COUNTED',
        ${expected.heldFull}, ${expected.heldEmpty}, ${input.countedFull}, ${input.countedEmpty},
        ${input.damagedFound},
        ${input.countedBy}::uuid, ${input.countedBy}::uuid, now(), now()
      )
    `)

    return { id, reference: allocated.formatted }
  })
}

export interface CloseReconciliationInput {
  readonly id: string
  readonly varianceReasonCodeId: string | null
  readonly varianceNarrative: string | null
  readonly actorId: string
}

export async function closeKeshaReconciliation(
  claims: DbClaims,
  input: CloseReconciliationInput,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const rows = await rawRows(
      tx,
      sql`select expected_full, expected_empty, counted_full, counted_empty from public.kesha_reconciliation where id = ${input.id}::uuid for update`,
    )
    const row = rows[0]
    if (!row) throw new Error(`Reconciliation ${input.id} not found`)

    const expectedTotal = KeshaCount.from(
      col.int(row.expected_full) + col.int(row.expected_empty),
    )
    const countedTotal = KeshaCount.from(col.int(row.counted_full) + col.int(row.counted_empty))
    const variance = countedTotal.subtract(expectedTotal)

    // Mirrors the M13 key control in `domain/reconciliation.ts`: a physical count that
    // disagrees with the ledger must be explained before it can be posted.
    if (!variance.isZero()) {
      const narrative = input.varianceNarrative?.trim() ?? ''
      if (!input.varianceReasonCodeId || narrative.length < 10) {
        throw new BusinessRuleViolation(ERROR_CODES.BAG_RECONCILIATION_IMBALANCE, {
          message:
            'The physical count does not match the ledger. Explain the difference with a reason code and a written note before posting.',
          details: {
            expected: expectedTotal.toNumber(),
            counted: countedTotal.toNumber(),
            variance: variance.toNumber(),
          },
        })
      }
    }

    await tx.execute(sql`
      update public.kesha_reconciliation
      set status = 'POSTED', reviewed_by = ${input.actorId}::uuid, reviewed_at = now(),
          posted_at = now(), variance_reason = ${input.varianceNarrative}, updated_at = now(),
          version = version + 1
      where id = ${input.id}::uuid
    `)
  })
}

import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import type { BusinessDate } from '@core/utils/date'
import { ValidationError } from '@core/errors/app-error'
import { addTariffLine as addTariffLineRow } from '../infrastructure/tariff-line.repository'

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
 * The DB CHECK constraint (`ck_tariff_line__negotiation_reason`) already enforces this, but
 * failing here gives the form a field-level error instead of a raw constraint violation.
 */
export async function addTariffLine(
  claims: DbClaims,
  input: AddTariffLineInput,
): Promise<{ id: string }> {
  if (input.contractId && !input.negotiationReason?.trim()) {
    throw new ValidationError({
      fieldErrors: [
        {
          path: 'negotiationReason',
          code: 'required',
          message: 'A negotiated rate requires a reason.',
        },
      ],
    })
  }

  return runInTransaction(claims, (tx) => addTariffLineRow(tx, input))
}

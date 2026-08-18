import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import type { BusinessDate } from '@core/utils/date'
import { createContractDraft } from '../infrastructure/contract.repository'

export interface CreateContractInput {
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

/** DRAFT status, CTR reference allocated. Negotiated tariff lines are added afterwards. */
export async function createContract(
  claims: DbClaims,
  input: CreateContractInput,
): Promise<{ contractId: string; reference: string }> {
  return runInTransaction(claims, async (tx) => {
    const { id, reference } = await createContractDraft(tx, input)
    return { contractId: id, reference }
  })
}

import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { startWorkflow } from '@modules/workflow'
import { logger } from '@core/logging/logger'
import {
  activateContract as activateContractRow,
  type ContractRow,
} from '../infrastructure/contract.repository'

export interface ActivateContractInput {
  readonly contractId: string
  readonly actorId: string
}

/**
 * DRAFT → ACTIVE, then a best-effort approval workflow start.
 *
 * The transition itself is the key control and always commits. Starting a workflow is a
 * separate, best-effort step afterwards — a `workflow_definition` for `entityType: 'contract'`
 * may not exist yet, and a workflow outage must never block a contract from activating.
 */
export async function activateContract(
  claims: DbClaims,
  input: ActivateContractInput,
): Promise<ContractRow> {
  const contract = await runInTransaction(claims, (tx) =>
    activateContractRow(tx, input.contractId, input.actorId),
  )

  try {
    await startWorkflow(claims, {
      entityType: 'contract',
      entityId: input.contractId,
      contextValue: Number(contract.creditLimitAmount ?? 0),
      startedBy: input.actorId,
    })
  } catch (error) {
    logger.warn(
      { err: error, contractId: input.contractId },
      'contract activated but starting its approval workflow failed',
    )
  }

  return contract
}

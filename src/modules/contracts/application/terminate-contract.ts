import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import {
  terminateContract as terminateContractRow,
  type ContractRow,
} from '../infrastructure/contract.repository'

export interface TerminateContractInput {
  readonly contractId: string
  readonly reason: string
  readonly actorId: string
}

export async function terminateContract(
  claims: DbClaims,
  input: TerminateContractInput,
): Promise<ContractRow> {
  return runInTransaction(claims, (tx) =>
    terminateContractRow(tx, input.contractId, input.reason, input.actorId),
  )
}

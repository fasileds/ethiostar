import 'server-only'
import type { DbClaims } from '@db/client'
import { queryAs } from '@db/client'
import {
  listContractsForCustomer,
  type ContractRow,
} from '../infrastructure/contract.repository'

/** The portal's own-contract screen. RLS (`p_contract__customer`) already scopes this to the
 *  caller's own customer, but passing `customerId` explicitly keeps the query narrow. */
export async function listMyContracts(
  claims: DbClaims,
  customerId: string,
): Promise<ContractRow[]> {
  return queryAs(claims, (tx) => listContractsForCustomer(tx, customerId))
}

/** M10 — Contract, Tariff & Service Agreement Management. */

export { SERVICE_CODES, SERVICE_CODE_LIST, type ServiceCode } from './domain/service-codes'

export {
  resolveApplicableTariffLine,
  type TariffLineCandidate,
  type ResolveTariffLineInput,
} from './domain/resolve-tariff-line'

export {
  listContractsAdmin,
  listContractsForCustomer,
  findContract,
  findActiveContractAsOf,
  type ContractRow,
} from './infrastructure/contract.repository'

export {
  listTariffLinesForBranchService,
  listStandardTariff,
  listContractTariff,
  type TariffLineRow,
} from './infrastructure/tariff-line.repository'

export { createContract, type CreateContractInput } from './application/create-contract'
export { activateContract, type ActivateContractInput } from './application/activate-contract'
export {
  terminateContract,
  type TerminateContractInput,
} from './application/terminate-contract'
export { addTariffLine, type AddTariffLineInput } from './application/add-tariff-line'
export { listMyContracts } from './application/list-my-contracts'

/** THE function M19 (billing) calls to price a charge. */
export {
  resolveTariffRate,
  type ResolveTariffRateInput,
  type ResolvedTariffRate,
} from './application/resolve-tariff-rate'

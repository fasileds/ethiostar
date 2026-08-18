import type { BusinessDate } from '@core/utils/date'
import { versionAsOf, type EffectiveDated } from '@modules/master-data'

/**
 * M10 key control: "the pricing in the active contract is what M19 uses; staff cannot
 * silently invoice a different rate."
 *
 * A tariff line is effective-dated within its (contract-or-null, branch, service) key,
 * exactly like a `bag_type_version` or `labour_rate`. Resolving one is therefore the same
 * `versionAsOf` lookup used everywhere else — applied twice: once against the customer's
 * own contract lines (if any), falling back to the branch's standard (contractId null)
 * lines when the contract has none covering the date, or when there is no active contract
 * at all.
 */

export interface TariffLineCandidate extends EffectiveDated {
  readonly contractId: string | null
  readonly branchId: string
  readonly serviceCode: string
  readonly uom: string
  readonly rateAmount: string
  readonly currency: string
}

export interface ResolveTariffLineInput {
  /** The customer's active contract at `asOfDate`, or null when there is none. */
  readonly contractId: string | null
  readonly branchId: string
  readonly serviceCode: string
  readonly asOfDate: BusinessDate
}

/**
 * `lines` is every tariff line for the branch + service code — both the contract's own
 * (if `contractId` is given) and the branch standard set — so the caller does one fetch and
 * this function does the picking. Returns undefined when neither covers `asOfDate`.
 */
export function resolveApplicableTariffLine(
  lines: readonly TariffLineCandidate[],
  input: ResolveTariffLineInput,
): TariffLineCandidate | undefined {
  const forBranchService = lines.filter(
    (line) => line.branchId === input.branchId && line.serviceCode === input.serviceCode,
  )

  if (input.contractId) {
    const contractLines = forBranchService.filter(
      (line) => line.contractId === input.contractId,
    )
    const negotiated = versionAsOf(contractLines, input.asOfDate)
    if (negotiated) return negotiated
  }

  const standardLines = forBranchService.filter((line) => line.contractId === null)
  return versionAsOf(standardLines, input.asOfDate) ?? undefined
}

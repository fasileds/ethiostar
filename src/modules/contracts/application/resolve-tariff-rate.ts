import 'server-only'
import type { Tx } from '@db/client'
import type { BusinessDate } from '@core/utils/date'
import { findActiveContractAsOf } from '../infrastructure/contract.repository'
import { listTariffLinesForBranchService } from '../infrastructure/tariff-line.repository'
import { resolveApplicableTariffLine } from '../domain/resolve-tariff-line'

export interface ResolveTariffRateInput {
  readonly customerId: string
  readonly branchId: string
  readonly serviceCode: string
  readonly asOfDate: BusinessDate
}

export interface ResolvedTariffRate {
  readonly rateAmount: string
  readonly uom: string
  readonly currency: string
  readonly contractId: string | null
}

/**
 * THE function M19 (billing) calls to price a charge. THE M10 key control: the customer's
 * active contract at the event date is checked first — never "today" — and only a line the
 * contract actually negotiated for this service wins; everything else falls back to the
 * branch standard tariff. Returns undefined when no line covers the date at all, which M19
 * must treat as "cannot price this charge", not as zero.
 *
 * Takes an open `tx` rather than `claims` — billing calls this from inside its own charge-
 * raising transaction, and a rate resolved outside that transaction could race a tariff
 * change landing in between.
 */
export async function resolveTariffRate(
  tx: Tx,
  input: ResolveTariffRateInput,
): Promise<ResolvedTariffRate | undefined> {
  const activeContract = await findActiveContractAsOf(
    tx,
    input.customerId,
    input.branchId,
    input.asOfDate,
  )

  const rows = await listTariffLinesForBranchService(tx, input.branchId, input.serviceCode)
  const lines = rows.map((row) => ({
    ...row,
    effectiveFrom: row.effectiveFrom as BusinessDate,
    effectiveTo: row.effectiveTo as BusinessDate | null,
  }))

  const resolved = resolveApplicableTariffLine(lines, {
    contractId: activeContract?.id ?? null,
    branchId: input.branchId,
    serviceCode: input.serviceCode,
    asOfDate: input.asOfDate,
  })

  if (!resolved) return undefined

  return {
    rateAmount: resolved.rateAmount,
    uom: resolved.uom,
    currency: resolved.currency,
    contractId: resolved.contractId,
  }
}

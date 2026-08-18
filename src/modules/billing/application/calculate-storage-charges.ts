import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { systemClock } from '@core/clock/clock'
import {
  toBusinessDate,
  addBusinessDays,
  daysBetween,
  type BusinessDate,
} from '@core/utils/date'
import { Decimal } from '@core/units/decimal'
import { SERVICE_CODES, findActiveContractAsOf } from '@modules/contracts'
import { insertChargeEvent } from '../infrastructure/charge-event.repository'
import { lotsInStore, insertStorageCharge } from '../infrastructure/storage-charge.repository'
import {
  activeTiersForBranch,
  type StorageRateTierRow,
} from '../infrastructure/storage-rate.repository'

export interface CalculateStorageChargesInput {
  readonly asOfDate?: BusinessDate
  readonly actorId: string
}

/** The tier rate for dwell-day `d` (0-indexed) — the highest `fromDay` threshold at or below it. */
function tierRateFor(
  tiers: readonly StorageRateTierRow[],
  dwellDay: number,
): StorageRateTierRow | undefined {
  let best: StorageRateTierRow | undefined
  for (const tier of tiers) {
    if (tier.fromDay <= dwellDay && (!best || tier.fromDay > best.fromDay)) best = tier
  }
  return best
}

/**
 * M20 — periodic storage/demurrage charging. For every lot in store, prices the un-charged
 * dwell-time span since the last `storage_charge.to_date` (or `storage_start_date` if never
 * charged) through `asOfDate`, applying the customer's free-storage days and then the
 * branch's tiered per-kg-per-day rate, day by day (a span can cross a tier boundary, and the
 * free-day allowance can end partway through it).
 *
 * The schema stores one rate per `storage_charge` row, so a span that crosses a tier boundary
 * is billed at a single BLENDED rate — `amount / (quantityKg * chargeableDays)` — computed
 * from the accurate per-day total. `daysCharged` counts only the chargeable days; `fromDate`/
 * `toDate` cover the full span (including any leading free days) so the next run's
 * "un-charged since" cursor is unambiguous.
 *
 * Callable directly (a "Run storage charging" staff button) and safe to re-run: a lot with
 * nothing new to charge — the whole new span still inside the free allowance — is simply
 * skipped, and picked up again (correctly, with the free days already accounted for) next run.
 */
export async function calculateStorageCharges(
  claims: DbClaims,
  input: CalculateStorageChargesInput,
): Promise<{ chargesCreated: number }> {
  return runInTransaction(claims, async (tx) => {
    const asOfDate = input.asOfDate ?? toBusinessDate(systemClock.now())
    const lots = await lotsInStore(tx)
    const tierCache = new Map<string, StorageRateTierRow[]>()
    let chargesCreated = 0

    for (const lot of lots) {
      const fromDate = lot.lastChargedToDate
        ? addBusinessDays(lot.lastChargedToDate as BusinessDate, 1)
        : (lot.storageStartDate as BusinessDate)

      if (daysBetween(fromDate, asOfDate as BusinessDate) < 0) continue // nothing new since last run

      const contract = await findActiveContractAsOf(
        tx,
        lot.customerId,
        lot.branchId,
        asOfDate as BusinessDate,
      )
      const freeDays = contract?.freeStorageDays ?? 0

      let tiers = tierCache.get(lot.branchId)
      if (!tiers) {
        tiers = await activeTiersForBranch(tx, lot.branchId)
        tierCache.set(lot.branchId, tiers)
      }

      const dwellAtStart = daysBetween(lot.storageStartDate as BusinessDate, fromDate)
      const spanDays = daysBetween(fromDate, asOfDate as BusinessDate) + 1
      const quantity = Decimal.parse(lot.quantityKg, 3)

      let total = Decimal.zero(2)
      let chargeableDays = 0
      for (let offset = 0; offset < spanDays; offset++) {
        const dwellDay = dwellAtStart + offset
        if (dwellDay < freeDays) continue
        const tier = tierRateFor(tiers, dwellDay)
        if (!tier) continue
        const rate = Decimal.parse(tier.ratePerKgPerDay, 2)
        total = total.add(rate.multiply(quantity))
        chargeableDays += 1
      }

      if (chargeableDays === 0) continue

      // Informational only — `amount` above (accumulated day-by-day, tier-by-tier) is the
      // authoritative billed figure. This is just amount / (kg * days), for display on the
      // storage_charge row's single rate column.
      const denominator = Number(quantity.toString()) * chargeableDays
      const effectiveRate =
        denominator > 0 ? (Number(total.toString()) / denominator).toFixed(2) : '0.00'
      const currency = tiers[0]?.currency ?? 'ETB'

      const chargeEventId = await insertChargeEvent(tx, {
        customerId: lot.customerId,
        branchId: lot.branchId,
        contractId: contract?.id ?? null,
        serviceCode: SERVICE_CODES.STORAGE_PER_DAY,
        sourceType: 'lot',
        sourceId: lot.lotId,
        quantity: String(chargeableDays),
        keshaQuantity: null,
        uom: 'PER_DAY',
        rateAmount: effectiveRate,
        amount: total.toString(),
        currency,
        occurredAt: systemClock.now(),
        actorId: input.actorId,
      })

      await insertStorageCharge(tx, {
        lotId: lot.lotId,
        customerId: lot.customerId,
        fromDate,
        toDate: asOfDate as BusinessDate,
        daysCharged: chargeableDays,
        quantityKg: lot.quantityKg,
        ratePerKgPerDay: effectiveRate,
        amount: total.toString(),
        chargeEventId,
        actorId: input.actorId,
      })
      chargesCreated += 1
    }

    return { chargesCreated }
  })
}

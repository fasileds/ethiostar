import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { KeshaCount } from '@core/units/kesha'
import { calculateEarnings, type SplitMethod, type GangMember } from '../domain/piece-rate'
import {
  crewMemberIds,
  findActiveRate,
  insertLabourOutput,
  approveLabourOutputRow,
} from '../infrastructure/labour.repository'

/**
 * Record a crew's output and calculate what it earned — in one call, because the two are
 * inseparable under the M18 key control: `confirmedKeshaCount` below is never a form field.
 *
 * It is read by the CALLER from wherever the count is already confirmed — a goods receipt's
 * `received_kesha_count`, a job order's issued/output totals — and passed in as a plain
 * number. `labour_output.kesha_count` therefore has no independent entry path anywhere in
 * this codebase: every call site that reaches this function is required to have sourced the
 * number from an already-posted operational record, and the server actions calling it read
 * that record themselves rather than trusting a submitted field.
 */
export interface RecordCrewOutputInput {
  readonly branchId: string
  readonly crewId: string
  readonly jobOrderId: string | null
  readonly activityTypeId: string
  readonly producedOn: string
  /** THE CONFIRMED COUNT — sourced from the operational record, never typed. */
  readonly confirmedKeshaCount: number
  readonly splitMethod: SplitMethod
  readonly individualCounts?: ReadonlyMap<string, number>
  readonly isOvertime: boolean
  readonly isNightShift: boolean
  readonly isHoliday: boolean
  readonly actorId: string
}

export async function recordCrewOutput(
  claims: DbClaims,
  input: RecordCrewOutputInput,
): Promise<{ outputIds: string[]; totalAmount: string }> {
  return runInTransaction(claims, async (tx) => {
    const workerIds = await crewMemberIds(tx, input.crewId)
    const rate = await findActiveRate(
      tx,
      input.activityTypeId,
      input.branchId,
      input.producedOn,
    )

    const members: GangMember[] = workerIds.map((workerId) => ({
      workerId,
      individualCount: input.individualCounts?.get(workerId) ?? 0,
    }))

    const result = calculateEarnings({
      confirmedKeshaCount: KeshaCount.from(input.confirmedKeshaCount),
      rate,
      members,
      splitMethod: input.splitMethod,
      isOvertime: input.isOvertime,
      isNightShift: input.isNightShift,
      isHoliday: input.isHoliday,
    })

    const outputIds: string[] = []
    for (const worker of result.perWorker) {
      const id = await insertLabourOutput(tx, {
        workerId: worker.workerId,
        crewId: input.crewId,
        jobOrderId: input.jobOrderId,
        activityTypeId: input.activityTypeId,
        producedOn: input.producedOn,
        keshaCount: worker.attributedCount,
        rateId: rate.id,
        rateAmount: rate.amountPerKesha.toAmountString(),
        calculatedAmount: worker.share.toAmountString(),
        currency: rate.amountPerKesha.currency,
        recordedBy: input.actorId,
      })
      outputIds.push(id)
    }

    return { outputIds, totalAmount: result.grossAmount.toAmountString() }
  })
}

export async function approveLabourOutput(
  claims: DbClaims,
  labourOutputId: string,
  actorId: string,
): Promise<void> {
  await runInTransaction(claims, (tx) => approveLabourOutputRow(tx, labourOutputId, actorId))
}

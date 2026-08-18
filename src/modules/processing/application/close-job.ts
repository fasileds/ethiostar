import 'server-only'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { Decimal } from '@core/units/decimal'
import { systemClock } from '@core/clock/clock'
import { transitionConsignment } from '@modules/consignment'
import { postMovements, type StockMovement } from '@modules/stock'
import { findLossAccountSection } from '@modules/warehouse'
import { queueNotification, NOTIFICATION_TEMPLATES } from '@modules/notification'
import { findCustomer } from '@modules/customers'
import {
  computeMassBalance,
  assertMayClose,
  type OutputLine,
  type LossLine,
} from '../domain/mass-balance'
import {
  lockJobOrder,
  transitionJobOrder,
  insertJobOrderOutput,
  loadJobLines,
  applyCloseFields,
} from '../infrastructure/job-order.repository'

/** See execute-job.ts for why this is a constant rather than a read from settings. */
const DEFAULT_TOLERANCE_PCT = Decimal.parse('2.000', 3)

export interface RecordLossInput {
  readonly jobOrderId: string
  readonly reasonCodeId: string
  readonly quantityKg: string
  readonly actorId: string
}

/**
 * Record process loss. Attributed to the job's FIRST input lot for the stock_movement's
 * mandatory `lot_id` — the mass balance is computed by CORRELATION ID (every movement
 * sharing this job's id), not per lot, so which specific input lot anchors the loss row
 * does not change the arithmetic. That lot's own balance nets to zero regardless; the loss
 * quantity lands in the loss-account location, which is what keeps every kilogram at a
 * defined location, including the kilograms that became dust and chaff.
 */
export async function recordLoss(claims: DbClaims, input: RecordLossInput): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const job = await lockJobOrder(tx, input.jobOrderId)
    const now = systemClock.now()
    const lossLocationId = await findLossAccountSection(tx, job.branchId)
    const { inputs, outputs } = await loadJobLines(tx, input.jobOrderId)
    const anchorLotId = inputs[0]?.lotId
    if (!anchorLotId) {
      throw new Error(`Job order ${input.jobOrderId} has no input lots to attribute loss to`)
    }

    const movement: StockMovement = {
      movementType: 'PROCESS_LOSS',
      occurredAt: now,
      lotId: anchorLotId,
      customerId: job.customerId,
      consignmentId: job.consignmentId,
      locationId: lossLocationId,
      quantityKg: Weight.positiveFromKg(input.quantityKg),
      keshaCount: KeshaCount.zero(),
      bagTypeId: null,
      reasonCodeId: input.reasonCodeId,
      sourceType: 'job_order',
      sourceId: input.jobOrderId,
      actorId: input.actorId,
      witnessId: null,
      narrative: null,
      correlationId: input.jobOrderId,
    }
    const [movementId] = await postMovements(tx, [movement])
    if (!movementId) return

    await insertJobOrderOutput(
      tx,
      input.jobOrderId,
      outputs.length + 1,
      {
        classificationId: null,
        isLoss: true,
        quantityKg: input.quantityKg,
        keshaCount: null,
        lotId: null,
        locationId: lossLocationId,
        coffeeGradeId: null,
        notes: null,
      },
      null,
      movementId,
      input.actorId,
    )
  })
}

export interface CloseJobInput {
  readonly jobOrderId: string
  readonly varianceExplanation: string | null
  readonly varianceReasonCodeId: string | null
  readonly actorId: string
  /** True only when the actor holds `job_order:close_with_variance`. */
  readonly mayCloseWithVariance: boolean
}

type JobLines = Awaited<ReturnType<typeof loadJobLines>>

function computeJobBalance(inputs: JobLines['inputs'], outputs: JobLines['outputs']) {
  const inputKg = Weight.sum(inputs.map((i) => Weight.fromKg(i.quantityKg)))
  const outputLines: OutputLine[] = outputs
    .filter((o) => !o.isLoss)
    .map((o) => ({
      classificationCode: o.classificationCode ?? '',
      quantityKg: Weight.fromKg(o.quantityKg),
      keshaCount: KeshaCount.from(o.keshaCount),
      bagTypeId: '',
      locationId: o.locationId ?? '',
    }))
  const lossLines: LossLine[] = outputs
    .filter((o) => o.isLoss)
    .map((o) => ({ reasonCodeId: '', quantityKg: Weight.fromKg(o.quantityKg) }))

  return computeMassBalance({
    inputKg,
    outputs: outputLines,
    losses: lossLines,
    tolerancePct: DEFAULT_TOLERANCE_PCT,
  })
}

async function notifyJobClosed(
  tx: Tx,
  job: { customerId: string; reference: string },
  jobOrderId: string,
  outputs: JobLines['outputs'],
  balance: ReturnType<typeof computeJobBalance>,
  actorId: string,
): Promise<void> {
  const customer = await findCustomer(tx, job.customerId)
  if (!customer?.primaryEmail) return

  const kgOf = (code: string) =>
    outputs.find((o) => o.classificationCode === code)?.quantityKg ?? '0'
  const approvedPct =
    balance.yields.find((y) => y.classificationCode === 'APPROVED')?.yieldPct.toString() ?? '0'

  await queueNotification(tx, {
    templateCode: NOTIFICATION_TEMPLATES.PROCESSING_COMPLETED,
    recipientAddress: customer.primaryEmail,
    recipientCustomerId: job.customerId,
    variables: {
      contactName: customer.legalName,
      jobReference: job.reference,
      inputWeightKg: balance.inputKg.toKgString(),
      approvedKg: kgOf('APPROVED'),
      approvedPercent: approvedPct,
      cGradeKg: kgOf('C_GRADE'),
      gravityKg: kgOf('GRAVITY'),
      colourSorterKg: kgOf('COLOUR_SORTER'),
      lossKg: balance.lossKg.toKgString(),
    },
    sourceType: 'job_order',
    sourceId: jobOrderId,
    actorId,
  })
}

export async function closeJob(claims: DbClaims, input: CloseJobInput): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const job = await lockJobOrder(tx, input.jobOrderId)
    const now = systemClock.now()
    const { inputs, outputs } = await loadJobLines(tx, input.jobOrderId)

    const balance = computeJobBalance(inputs, outputs)

    assertMayClose({
      balance,
      varianceExplanation: input.varianceExplanation,
      varianceReasonCodeId: input.varianceReasonCodeId,
      mayCloseWithVariance: input.mayCloseWithVariance,
    })

    await transitionJobOrder(tx, input.jobOrderId, job.status, 'COMPLETED', input.actorId)
    await transitionJobOrder(tx, input.jobOrderId, 'COMPLETED', 'CLOSED', input.actorId)

    await applyCloseFields(tx, input.jobOrderId, {
      actualInputKg: balance.inputKg.toKgString(),
      actualOutputKg: balance.outputKg.toKgString(),
      actualLossKg: balance.lossKg.toKgString(),
      yieldPct: balance.outputKg.percentOf(balance.inputKg).toString(),
      lossPct: balance.lossPct.toString(),
      massBalanceStatus: balance.withinTolerance
        ? balance.varianceKg.isZero()
          ? 'BALANCED'
          : 'WITHIN_TOLERANCE'
        : 'EXCEPTION',
      toleranceAppliedPct: DEFAULT_TOLERANCE_PCT.toString(),
      varianceKg: balance.varianceKg.toKgString(),
      varianceApprovedBy: balance.withinTolerance ? null : input.actorId,
      varianceReason: balance.withinTolerance ? null : input.varianceExplanation,
    })

    await transitionConsignment(tx, {
      id: job.consignmentId,
      to: 'PROCESSED',
      actorId: input.actorId,
      occurredAt: now,
      correlationId: input.jobOrderId,
    })

    await notifyJobClosed(tx, job, input.jobOrderId, outputs, balance, input.actorId)
  })
}

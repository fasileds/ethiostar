import 'server-only'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { systemClock } from '@core/clock/clock'
import {
  transitionConsignment,
  transitionLot,
  createLot,
  addLotLineage,
} from '@modules/consignment'
import { postMovements, type StockMovement } from '@modules/stock'
import { queueNotification, NOTIFICATION_TEMPLATES } from '@modules/notification'
import { findCustomer } from '@modules/customers'
import {
  lockJobOrder,
  transitionJobOrder,
  insertJobOrderInput,
  insertJobOrderOutput,
  loadJobLines,
  type JobInputLine,
} from '../infrastructure/job-order.repository'

export interface StartJobInput {
  readonly jobOrderId: string
  readonly lots: ReadonlyArray<{
    readonly lotId: string
    readonly locationId: string
    readonly quantityKg: string
    readonly keshaCount: number | null
    readonly coffeeTypeId: string | null
    readonly coffeeGradeId: string | null
  }>
  readonly actorId: string
  /** True only when the actor holds `job_order:override_schedule`. */
  readonly overrideSchedule: boolean
}

type LockedJob = Awaited<ReturnType<typeof lockJobOrder>>

/** Consume one lot into the job: transition it, post the ISSUE_TO_JOB movement, record the line. */
async function issueLotToJob(
  tx: Tx,
  job: LockedJob,
  jobOrderId: string,
  lineNo: number,
  lot: StartJobInput['lots'][number],
  now: Date,
  actorId: string,
): Promise<void> {
  await transitionLot(tx, {
    id: lot.lotId,
    to: 'RESERVED_FOR_JOB',
    actorId,
    occurredAt: now,
    correlationId: jobOrderId,
  })
  await transitionLot(tx, {
    id: lot.lotId,
    to: 'CONSUMED',
    actorId,
    occurredAt: now,
    correlationId: jobOrderId,
  })

  const movement: StockMovement = {
    movementType: 'ISSUE_TO_JOB',
    occurredAt: now,
    lotId: lot.lotId,
    customerId: job.customerId,
    consignmentId: job.consignmentId,
    locationId: lot.locationId,
    quantityKg: Weight.positiveFromKg(lot.quantityKg).negate(),
    keshaCount:
      lot.keshaCount !== null
        ? KeshaCount.positive(lot.keshaCount).negate()
        : KeshaCount.zero(),
    bagTypeId: null,
    reasonCodeId: null,
    sourceType: 'job_order',
    sourceId: jobOrderId,
    actorId,
    witnessId: null,
    narrative: null,
    correlationId: jobOrderId,
  }
  const [movementId] = await postMovements(tx, [movement])
  if (movementId) {
    const line: JobInputLine = lot
    await insertJobOrderInput(tx, jobOrderId, lineNo, line, movementId, actorId)
  }
}

async function notifyJobStarted(
  tx: Tx,
  job: LockedJob,
  jobOrderId: string,
  inputKg: Weight,
  now: Date,
  actorId: string,
): Promise<void> {
  const customer = await findCustomer(tx, job.customerId)
  if (!customer?.primaryEmail) return

  await queueNotification(tx, {
    templateCode: NOTIFICATION_TEMPLATES.PROCESSING_STARTED,
    recipientAddress: customer.primaryEmail,
    recipientCustomerId: job.customerId,
    variables: {
      contactName: customer.legalName,
      jobReference: job.reference,
      inputWeightKg: inputKg.toKgString(),
      startedAt: now.toISOString(),
    },
    sourceType: 'job_order',
    sourceId: jobOrderId,
    actorId,
  })
}

/**
 * Accept, start and issue lots to a job — one call. `job_order:start` and issuing input are
 * inseparable in this data model (a job with no input is not running), so splitting them
 * into three round trips would only add states where a job is "started" with nothing in it.
 */
export async function startJob(claims: DbClaims, input: StartJobInput): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const job = await lockJobOrder(tx, input.jobOrderId)
    const now = systemClock.now()

    if (job.scheduledStartAt && now < job.scheduledStartAt && !input.overrideSchedule) {
      throw new BusinessRuleViolation(ERROR_CODES.JOB_STARTED_BEFORE_WINDOW, {
        message: 'This job cannot start before its scheduled window without an override.',
        details: { scheduledStartAt: job.scheduledStartAt.toISOString() },
      })
    }

    await transitionJobOrder(tx, input.jobOrderId, job.status, 'RELEASED', input.actorId)
    await transitionJobOrder(tx, input.jobOrderId, 'RELEASED', 'IN_PROGRESS', input.actorId)

    for (const [index, lot] of input.lots.entries()) {
      await issueLotToJob(tx, job, input.jobOrderId, index + 1, lot, now, input.actorId)
    }

    await transitionConsignment(tx, {
      id: job.consignmentId,
      to: 'IN_PROCESS',
      actorId: input.actorId,
      occurredAt: now,
      correlationId: input.jobOrderId,
    })

    const inputKg = Weight.sum(input.lots.map((l) => Weight.positiveFromKg(l.quantityKg)))
    await notifyJobStarted(tx, job, input.jobOrderId, inputKg, now, input.actorId)
  })
}

export interface RecordOutputInput {
  readonly jobOrderId: string
  readonly classificationCode: string
  readonly classificationId: string
  readonly quantityKg: string
  readonly keshaCount: number
  readonly bagTypeId: string | null
  readonly locationId: string
  readonly actorId: string
}

async function createOutputLot(
  tx: Tx,
  job: LockedJob,
  input: RecordOutputInput,
  inputs: ReadonlyArray<{ lotId: string; quantityKg: string }>,
  now: Date,
): Promise<{ id: string; reference: string }> {
  const lot = await createLot(tx, {
    consignmentId: job.consignmentId,
    customerId: job.customerId,
    bagTypeId: input.bagTypeId,
    outputClassificationId: input.classificationId,
    initialQuantityKg: input.quantityKg,
    initialKeshaCount: input.keshaCount,
    storageStartDate: now.toISOString().slice(0, 10),
    actorId: input.actorId,
    occurredAt: now,
    correlationId: input.jobOrderId,
    initialStatus: 'PRODUCED',
  })

  for (const parent of inputs) {
    await addLotLineage(tx, parent.lotId, lot.id, input.jobOrderId)
  }

  return lot
}

export async function recordOutput(claims: DbClaims, input: RecordOutputInput): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const job = await lockJobOrder(tx, input.jobOrderId)
    const now = systemClock.now()
    const { inputs, outputs } = await loadJobLines(tx, input.jobOrderId)

    const lot = await createOutputLot(tx, job, input, inputs, now)

    const movement: StockMovement = {
      movementType: 'OUTPUT_FROM_JOB',
      occurredAt: now,
      lotId: lot.id,
      customerId: job.customerId,
      consignmentId: job.consignmentId,
      locationId: input.locationId,
      quantityKg: Weight.positiveFromKg(input.quantityKg),
      keshaCount: KeshaCount.positive(input.keshaCount),
      bagTypeId: input.bagTypeId,
      reasonCodeId: null,
      sourceType: 'job_order',
      sourceId: input.jobOrderId,
      actorId: input.actorId,
      witnessId: null,
      narrative: null,
      correlationId: input.jobOrderId,
    }
    const [movementId] = await postMovements(tx, [movement])
    if (!movementId) return

    const totalInputKg = Weight.sum(inputs.map((i) => Weight.fromKg(i.quantityKg)))
    const percentOfInput = totalInputKg.isZero()
      ? null
      : Weight.positiveFromKg(input.quantityKg).percentOf(totalInputKg).toString()

    await insertJobOrderOutput(
      tx,
      input.jobOrderId,
      outputs.length + 1,
      {
        classificationId: input.classificationId,
        isLoss: false,
        quantityKg: input.quantityKg,
        keshaCount: input.keshaCount,
        lotId: lot.id,
        locationId: input.locationId,
        coffeeGradeId: null,
        notes: null,
      },
      percentOfInput,
      movementId,
      input.actorId,
    )
  })
}

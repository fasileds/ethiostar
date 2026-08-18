import 'server-only'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { systemClock } from '@core/clock/clock'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'
import { transitionConsignment, transitionLot } from '@modules/consignment'
import { postMovements, type StockMovement } from '@modules/stock'
import { queueNotification, NOTIFICATION_TEMPLATES } from '@modules/notification'
import { findCustomer } from '@modules/customers'
import {
  evaluateClearance,
  assertGatePassUsable,
  registrationsMatch,
  type HoldReason,
} from '../domain/clearance'
import {
  lockDispatchOrder,
  transitionDispatchOrder,
  insertDispatchLine,
  dispatchLinesFor,
  setLoadedTotals,
  setClearance,
  tryRecordGateOut,
  type DispatchLineInput,
} from '../infrastructure/dispatch-order.repository'
import { releaseLotsFor, customerHoldsFor } from '../infrastructure/clearance-inputs.query'

export interface LoadDispatchInput {
  readonly dispatchOrderId: string
  readonly lines: readonly DispatchLineInput[]
  readonly actorId: string
}

/** Load the truck: record what actually went on it. No ledger movement yet — see gate-out. */
export async function loadDispatch(claims: DbClaims, input: LoadDispatchInput): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const order = await lockDispatchOrder(tx, input.dispatchOrderId)

    await transitionDispatchOrder(tx, input.dispatchOrderId, order.status, 'LOADING')
    await transitionDispatchOrder(tx, input.dispatchOrderId, 'LOADING', 'LOADED')

    for (const [index, line] of input.lines.entries()) {
      await insertDispatchLine(tx, input.dispatchOrderId, index + 1, line, null, input.actorId)
    }

    const totalKg = Weight.sum(input.lines.map((l) => Weight.positiveFromKg(l.quantityKg)))
    const totalKesha = KeshaCount.sum(input.lines.map((l) => KeshaCount.positive(l.keshaCount)))
    await setLoadedTotals(
      tx,
      input.dispatchOrderId,
      totalKg.toKgString(),
      totalKesha.toNumber(),
    )
  })
}

async function notifyGatePassIssued(
  tx: Tx,
  order: { customerId: string; reference: string; vehiclePlate: string | null },
  dispatchOrderId: string,
  actorId: string,
): Promise<void> {
  const customer = await findCustomer(tx, order.customerId)
  if (!customer?.primaryEmail) return

  await queueNotification(tx, {
    templateCode: NOTIFICATION_TEMPLATES.GATE_PASS_ISSUED,
    recipientAddress: customer.primaryEmail,
    recipientCustomerId: order.customerId,
    variables: {
      contactName: customer.legalName,
      gatePassNumber: order.reference,
      quantityKg: '0',
      keshaCount: 0,
      vehiclePlate: order.vehiclePlate ?? '',
      driverName: '',
      validUntil: systemClock.now().toISOString(),
    },
    sourceType: 'dispatch_order',
    sourceId: dispatchOrderId,
    actorId,
  })
}

/**
 * Check clearance and, if clear, mark the order GATE_CLEARED — the moment the gate pass is
 * "issued" in this data model (see `dispatch-order.repository.ts`'s note on why there is no
 * separate gate_pass row for M17).
 */
export async function clearForGate(
  claims: DbClaims,
  dispatchOrderId: string,
  actorId: string,
  actorPermissions: ReadonlySet<string>,
  overrideJustification: string | null,
  /**
   * M19's financial hold (docs/architecture/07-extension-points.md Seam 4). `dispatch` sits
   * below `billing` in the module tiers and cannot import it, so the caller — the 'use
   * server' action that has already imported `financialHoldsFor` from `@modules/billing`,
   * which the app tier may do freely — passes the result in here. Optional and empty by
   * default so every existing caller keeps working unchanged.
   */
  additionalCustomerHolds: readonly HoldReason[] = [],
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const order = await lockDispatchOrder(tx, dispatchOrderId)
    const lots = await releaseLotsFor(tx, dispatchOrderId)
    const holds = [
      ...(await customerHoldsFor(tx, order.customerId)),
      ...additionalCustomerHolds,
    ]

    const result = evaluateClearance({
      lots,
      customerHolds: holds,
      actorPermissions,
      overrideJustification,
    })

    if (!result.cleared) {
      await setClearance(tx, dispatchOrderId, {
        status: 'BLOCKED',
        note: result.blockers.map((b) => b.message).join('; '),
        checkedBy: actorId,
        overrideApprovedBy: null,
        overrideReason: null,
      })
      throw new BusinessRuleViolation(ERROR_CODES.CLEARANCE_FAILED, {
        message: 'This dispatch cannot be cleared.',
        details: { blockers: result.blockers },
      })
    }

    await setClearance(tx, dispatchOrderId, {
      status: 'CLEARED',
      note: null,
      checkedBy: actorId,
      overrideApprovedBy: result.overriddenHolds.length > 0 ? actorId : null,
      overrideReason: result.overriddenHolds.length > 0 ? overrideJustification : null,
    })
    await transitionDispatchOrder(tx, dispatchOrderId, order.status, 'GATE_CLEARED')

    await notifyGatePassIssued(tx, order, dispatchOrderId, actorId)
  })
}

async function postDispatchMovements(
  tx: Tx,
  order: { customerId: string; consignmentId: string },
  dispatchOrderId: string,
  actorId: string,
  now: Date,
): Promise<void> {
  const lines = await dispatchLinesFor(tx, dispatchOrderId)
  const movements: StockMovement[] = lines.map((line) => ({
    movementType: 'DISPATCH_OUT',
    occurredAt: now,
    lotId: line.lotId,
    customerId: order.customerId,
    consignmentId: order.consignmentId,
    locationId: line.locationId,
    quantityKg: Weight.positiveFromKg(line.quantityKg).negate(),
    keshaCount: KeshaCount.positive(line.keshaCount).negate(),
    bagTypeId: line.bagTypeId,
    reasonCodeId: null,
    sourceType: 'dispatch_order',
    sourceId: dispatchOrderId,
    actorId,
    witnessId: null,
    narrative: null,
    correlationId: dispatchOrderId,
  }))

  await postMovements(tx, movements)

  for (const line of lines) {
    await transitionLot(tx, {
      id: line.lotId,
      to: 'DISPATCHED',
      actorId,
      occurredAt: now,
      correlationId: dispatchOrderId,
    })
  }
}

/**
 * Gate-out: THE M17 key control. `tryRecordGateOut` is the single conditional UPDATE that
 * makes single-use atomic; everything else only runs once that has actually succeeded.
 */
export async function recordGateOut(
  claims: DbClaims,
  dispatchOrderId: string,
  presentedVehiclePlate: string,
  actorId: string,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const order = await lockDispatchOrder(tx, dispatchOrderId)
    const now = systemClock.now()

    assertGatePassUsable({
      pass: {
        id: dispatchOrderId,
        number: order.reference,
        status: order.status === 'GATE_CLEARED' ? 'ISSUED' : 'USED',
        vehicleRegistration: order.vehiclePlate ?? '',
        driverName: '',
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        usedAt: null,
      },
      presentedVehicleRegistration: presentedVehiclePlate,
      at: now,
    })

    if (order.vehiclePlate && !registrationsMatch(order.vehiclePlate, presentedVehiclePlate)) {
      throw new BusinessRuleViolation(ERROR_CODES.GATE_PASS_VEHICLE_MISMATCH, {
        message: `The vehicle at the gate does not match dispatch order ${order.reference}.`,
      })
    }

    const applied = await tryRecordGateOut(tx, dispatchOrderId)
    if (!applied) {
      throw new BusinessRuleViolation(ERROR_CODES.GATE_PASS_ALREADY_USED, {
        message: `Dispatch order ${order.reference} has already left, or is not cleared.`,
      })
    }

    await postDispatchMovements(tx, order, dispatchOrderId, actorId, now)
    await closeConsignmentAfterGateOut(tx, order.consignmentId, dispatchOrderId, actorId, now)
  })
}

async function closeConsignmentAfterGateOut(
  tx: Tx,
  consignmentId: string,
  dispatchOrderId: string,
  actorId: string,
  now: Date,
): Promise<void> {
  await transitionConsignment(tx, {
    id: consignmentId,
    to: 'DISPATCHED',
    actorId,
    occurredAt: now,
    correlationId: dispatchOrderId,
  })
  await transitionConsignment(tx, {
    id: consignmentId,
    to: 'CLOSED',
    actorId,
    occurredAt: now,
    correlationId: dispatchOrderId,
  })
}

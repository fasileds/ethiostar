import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { BusinessRuleViolation } from '@core/errors/app-error'
import { ERROR_CODES } from '@core/errors/error-codes'

/**
 * The stock ledger.
 *
 * A MUTABLE `quantity_on_hand` COLUMN IS FORBIDDEN AS A SOURCE OF TRUTH.
 *
 * This is a custody business. When a customer disputes a figure six months later, "the
 * column said 412 bags" is not an answer — the system must be able to show every movement
 * that produced it. A mutable column also loses concurrent updates, cannot be audited
 * retrospectively, and makes the physical-count variance report impossible to compute
 * honestly.
 *
 * The ledger is append-only and signed: + increases, − decreases. `stock_balance` is a
 * PROJECTION maintained in the same transaction, and can be rebuilt from the ledger at any
 * time. The reverse is not possible, and that asymmetry is the whole argument.
 *
 * docs/adr/0003-consignment-spine-and-stock-ledger.md
 */

export const MOVEMENT_TYPES = [
  'RECEIPT',
  'PLACEMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ISSUE_TO_JOB',
  'OUTPUT_FROM_JOB',
  'PROCESS_LOSS',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'DISPATCH_OUT',
  'COUNT_VARIANCE',
] as const

export type MovementType = (typeof MOVEMENT_TYPES)[number]

/** Movement types that must carry a reason code. */
export const REASON_REQUIRED_TYPES: readonly MovementType[] = [
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'COUNT_VARIANCE',
  'PROCESS_LOSS',
]

/**
 * The expected sign of each movement type.
 *
 * NOTE PROCESS_LOSS IS POSITIVE. Loss is a DESTINATION, not a second withdrawal: stock
 * leaves the input lot and arrives in the output lots *and* in the loss account. Recording
 * it negative double-counts it against the issue and makes every job appear short by
 * exactly the loss. It also keeps the M12 control true — every kilogram remains at a
 * defined location, including the kilograms that became dust and chaff.
 *
 * COUNT_VARIANCE IS EITHER. A physical count found either more or less than the ledger
 * believed, and both are the same movement type — the report that reads this (§7.2
 * "physical count variance") distinguishes overage from shortage by the sign on the row,
 * not by choosing between two types the way ADJUSTMENT_IN/OUT does. Constraining it to one
 * sign would make a shortage count — the common case — an error.
 */
export const MOVEMENT_SIGN: Readonly<Record<MovementType, 'POSITIVE' | 'NEGATIVE' | 'EITHER'>> =
  {
    RECEIPT: 'POSITIVE',
    PLACEMENT: 'POSITIVE',
    TRANSFER_OUT: 'NEGATIVE',
    TRANSFER_IN: 'POSITIVE',
    ISSUE_TO_JOB: 'NEGATIVE',
    OUTPUT_FROM_JOB: 'POSITIVE',
    PROCESS_LOSS: 'POSITIVE',
    ADJUSTMENT_IN: 'POSITIVE',
    ADJUSTMENT_OUT: 'NEGATIVE',
    DISPATCH_OUT: 'NEGATIVE',
    COUNT_VARIANCE: 'EITHER',
  }

export interface StockMovement {
  readonly movementType: MovementType
  readonly occurredAt: Date
  readonly lotId: string
  readonly customerId: string
  readonly consignmentId: string
  /** NOT NULL by schema — the M12 control "unallocated stock is not permitted". */
  readonly locationId: string
  /** SIGNED. */
  readonly quantityKg: Weight
  readonly keshaCount: KeshaCount
  readonly bagTypeId: string | null
  readonly reasonCodeId: string | null
  readonly sourceType: string
  readonly sourceId: string
  readonly actorId: string
  readonly witnessId: string | null
  readonly narrative: string | null
  /** Groups every movement of one business operation. */
  readonly correlationId: string
}

/** Validate a single movement's shape before it reaches the ledger. */
export function validateMovement(movement: StockMovement): void {
  const expected = MOVEMENT_SIGN[movement.movementType]

  if (expected === 'POSITIVE' && movement.quantityKg.isNegative()) {
    throw new BusinessRuleViolation(ERROR_CODES.LEDGER_IMBALANCE, {
      message: `${movement.movementType} must be a positive quantity.`,
      details: {
        movementType: movement.movementType,
        quantityKg: movement.quantityKg.toKgString(),
      },
    })
  }

  if (expected === 'NEGATIVE' && movement.quantityKg.isPositive()) {
    throw new BusinessRuleViolation(ERROR_CODES.LEDGER_IMBALANCE, {
      message: `${movement.movementType} must be a negative quantity.`,
      details: {
        movementType: movement.movementType,
        quantityKg: movement.quantityKg.toKgString(),
      },
    })
  }

  if (!movement.locationId) {
    throw new BusinessRuleViolation(ERROR_CODES.LOCATION_REQUIRED, {
      message:
        'Every movement must name a storage location. Unallocated stock is not permitted.',
    })
  }

  if (REASON_REQUIRED_TYPES.includes(movement.movementType) && !movement.reasonCodeId) {
    throw new BusinessRuleViolation(ERROR_CODES.ADJUSTMENT_REASON_REQUIRED, {
      message: `${movement.movementType} requires a reason code.`,
      details: { movementType: movement.movementType },
    })
  }

  if (movement.quantityKg.isZero() && movement.keshaCount.isZero()) {
    throw new BusinessRuleViolation(ERROR_CODES.LEDGER_IMBALANCE, {
      message: 'A movement must change at least one quantity.',
    })
  }
}

/**
 * A transfer must net to exactly zero.
 *
 * Two rows, equal magnitude, opposite signs, one correlation id. If the sum is non-zero,
 * stock has been created or destroyed by a movement that is supposed to relocate it.
 */
export function assertTransferBalances(movements: readonly StockMovement[]): void {
  const netKg = Weight.sum(movements.map((m) => m.quantityKg))
  const netKesha = KeshaCount.sum(movements.map((m) => m.keshaCount))

  if (!netKg.isZero() || !netKesha.isZero()) {
    throw new BusinessRuleViolation(ERROR_CODES.LEDGER_IMBALANCE, {
      message: 'A transfer must net to zero — stock is relocated, never created or destroyed.',
      details: { netKg: netKg.toKgString(), netKesha: netKesha.toNumber() },
    })
  }
}

/**
 * THE MASS BALANCE, EXPRESSED AS A LEDGER PROPERTY.
 *
 * The signed sum of every movement in one job must be exactly zero:
 *   ISSUE_TO_JOB (−) + OUTPUT_FROM_JOB (+) + PROCESS_LOSS (+) = 0
 *
 * This is the same invariant M15 states as "input weight equals the sum of all outputs plus
 * recorded process loss", checked at the ledger rather than only in the job aggregate — so
 * a job cannot be closed with a balance the ledger disagrees with.
 */
export function jobBalance(movements: readonly StockMovement[]): {
  balanced: boolean
  varianceKg: Weight
  inputKg: Weight
  outputKg: Weight
  lossKg: Weight
} {
  const byType = (type: MovementType) => movements.filter((m) => m.movementType === type)

  const inputKg = Weight.sum(byType('ISSUE_TO_JOB').map((m) => m.quantityKg)).abs()
  const outputKg = Weight.sum(byType('OUTPUT_FROM_JOB').map((m) => m.quantityKg))
  const lossKg = Weight.sum(byType('PROCESS_LOSS').map((m) => m.quantityKg))
  const varianceKg = Weight.sum(movements.map((m) => m.quantityKg))

  return {
    balanced: varianceKg.isZero(),
    varianceKg,
    inputKg,
    outputKg,
    lossKg,
  }
}

/** Build the two rows of a transfer, guaranteeing they net to zero by construction. */
export function buildTransfer(params: {
  from: string
  to: string
  quantityKg: Weight
  keshaCount: KeshaCount
  lotId: string
  customerId: string
  consignmentId: string
  bagTypeId: string | null
  occurredAt: Date
  actorId: string
  sourceId: string
  correlationId: string
  narrative: string | null
}): StockMovement[] {
  params.quantityKg.assertNonNegative('transfer quantity')
  params.keshaCount.assertNonNegative('transfer kesha count')

  const common = {
    occurredAt: params.occurredAt,
    lotId: params.lotId,
    customerId: params.customerId,
    consignmentId: params.consignmentId,
    bagTypeId: params.bagTypeId,
    reasonCodeId: null,
    sourceType: 'stock_transfer',
    sourceId: params.sourceId,
    actorId: params.actorId,
    witnessId: null,
    narrative: params.narrative,
    correlationId: params.correlationId,
  }

  const out: StockMovement = {
    ...common,
    movementType: 'TRANSFER_OUT',
    locationId: params.from,
    quantityKg: params.quantityKg.negate(),
    keshaCount: params.keshaCount.negate(),
  }

  const into: StockMovement = {
    ...common,
    movementType: 'TRANSFER_IN',
    locationId: params.to,
    quantityKg: params.quantityKg,
    keshaCount: params.keshaCount,
  }

  const pair = [out, into]
  pair.forEach(validateMovement)
  assertTransferBalances(pair)
  return pair
}

/** Balance for one (lot, location), derived from the ledger. */
export function balanceOf(movements: readonly StockMovement[]): {
  quantityKg: Weight
  keshaCount: KeshaCount
} {
  return {
    quantityKg: Weight.sum(movements.map((m) => m.quantityKg)),
    keshaCount: KeshaCount.sum(movements.map((m) => m.keshaCount)),
  }
}

/**
 * A balance may never go negative: you cannot remove coffee that is not there.
 * Checked in the domain before write, and again by a CHECK constraint on the projection.
 */
export function assertSufficientStock(
  currentKg: Weight,
  currentKesha: KeshaCount,
  requestedKg: Weight,
  requestedKesha: KeshaCount,
  lotLabel: string,
): void {
  if (requestedKg.greaterThan(currentKg) || requestedKesha.greaterThan(currentKesha)) {
    throw new BusinessRuleViolation(ERROR_CODES.INSUFFICIENT_STOCK, {
      message: `${lotLabel} does not hold enough stock for this movement.`,
      details: {
        lot: lotLabel,
        availableKg: currentKg.toKgString(),
        availableKesha: currentKesha.toNumber(),
        requestedKg: requestedKg.toKgString(),
        requestedKesha: requestedKesha.toNumber(),
      },
    })
  }
}

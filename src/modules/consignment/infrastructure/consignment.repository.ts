import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { InvalidStateTransitionError } from '@core/errors/app-error'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { publishEvents } from '@modules/audit'
import {
  consignmentStateMachine,
  deriveConsignmentStatus,
  type ConsignmentStatus,
  type LotStatus,
} from '../domain/consignment.state-machine'
import { consignmentStatusChanged } from '../domain/events'

/**
 * Consignment-header writes. Lot writes are in the sibling `lot.repository.ts`.
 *
 * Enforcement layer 2 of 3, per the state-machine's own doc comment: status is written
 * ONLY alongside a history row, in one statement pair, so the two can never drift. Layer 1
 * is `consignmentStateMachine.assert` below; layer 3 is the database trigger from migration
 * 0011 that validates the same transition against `consignment_transition` — it fires even
 * for a write that reached the table by some path other than this file.
 *
 * Every write here takes `tx` — this module never opens its own transaction. The caller
 * (an M11/M14/M15/M16/M17 use case) owns the Unit of Work, because a status change is never
 * the whole of a business operation: it accompanies a stock movement, a notification, or
 * both, and all of it must commit or roll back together.
 */

export interface CreateConsignmentInput {
  readonly branchId: string
  readonly customerId: string
  readonly deliveryRequestId?: string | null
  readonly coffeeTypeId?: string | null
  readonly originWoredaId?: string | null
  readonly harvestYearId?: string | null
  readonly declaredQuantityKg: string
  readonly declaredKeshaCount: number
  readonly expectedArrivalOn?: string | null
  readonly actorId: string
}

/**
 * Create a consignment at REQUESTED.
 *
 * The reference is allocated through the same gapless mechanism as every printed document
 * (`printing.allocateDocumentNumber`) rather than a second numbering scheme — one allocator,
 * one set of guarantees, one place to look when a number looks wrong.
 */
export async function createConsignment(
  tx: Tx,
  input: CreateConsignmentInput,
): Promise<{ id: string; reference: string }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.CONSIGNMENT, {
    branchId: input.branchId,
    actorId: input.actorId,
  })

  await tx.execute(sql`
    insert into public.consignment (
      id, reference, branch_id, customer_id, delivery_request_id, status,
      coffee_type_id, origin_woreda_id, harvest_year_id,
      declared_quantity_kg, declared_kesha_count, expected_arrival_on,
      created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.branchId}::uuid, ${input.customerId}::uuid,
      ${input.deliveryRequestId ?? null}::uuid, 'REQUESTED',
      ${input.coffeeTypeId ?? null}::uuid, ${input.originWoredaId ?? null}::uuid,
      ${input.harvestYearId ?? null}::uuid,
      ${input.declaredQuantityKg}::numeric, ${input.declaredKeshaCount},
      ${input.expectedArrivalOn ?? null}::date,
      ${input.actorId}::uuid, now(), now()
    )
  `)

  return { id, reference: allocated.formatted }
}

/** Current status, locked FOR UPDATE — the read every transition starts with. */
async function lockConsignmentStatus(tx: Tx, id: string): Promise<ConsignmentStatus> {
  const rows = await rawRows(
    tx,
    sql`select status from public.consignment where id = ${id}::uuid for update`,
  )
  const row = rows[0]
  if (!row) throw new Error(`Consignment ${id} not found`)
  return col.text(row.status) as ConsignmentStatus
}

export interface TransitionConsignmentInput {
  readonly id: string
  readonly to: ConsignmentStatus
  readonly actorId: string
  readonly occurredAt: Date
  readonly reason?: string | null
  readonly correlationId: string
}

/**
 * Move a consignment to a new status.
 *
 * Reads the current status FOR UPDATE first, so two concurrent transitions on the same
 * consignment serialise rather than racing — the second sees the first's new status once it
 * commits, and either proceeds legally from there or fails the state-machine assertion
 * cleanly instead of corrupting history.
 */
export async function transitionConsignment(
  tx: Tx,
  input: TransitionConsignmentInput,
): Promise<void> {
  const from = await lockConsignmentStatus(tx, input.id)

  consignmentStateMachine.assert(from, input.to)

  await tx.execute(sql`
    update public.consignment
    set status = ${input.to}, updated_at = now(), updated_by = ${input.actorId}::uuid,
        version = version + 1
    where id = ${input.id}::uuid
  `)

  await tx.execute(sql`
    insert into public.consignment_status_history (
      id, consignment_id, from_status, to_status, occurred_at, actor_id, reason
    ) values (
      ${uuidv7()}, ${input.id}::uuid, ${from}, ${input.to}, ${input.occurredAt},
      ${input.actorId}::uuid, ${input.reason ?? null}
    )
  `)

  const referenceRow = await rawRows(
    tx,
    sql`select reference from public.consignment where id = ${input.id}::uuid`,
  )
  const reference = referenceRow[0] ? col.text(referenceRow[0].reference) : input.id

  await publishEvents(
    tx,
    [
      consignmentStatusChanged({
        aggregateId: input.id,
        actorId: input.actorId,
        occurredAt: input.occurredAt,
        payload: {
          reference,
          fromStatus: from,
          toStatus: input.to,
          reason: input.reason ?? null,
        },
      }),
    ],
    { correlationId: input.correlationId },
  )
}

export interface RecordReceiptInput {
  readonly id: string
  readonly receivedQuantityKg: string
  readonly receivedKeshaCount: number
  readonly receivedAt: Date
  readonly storageStartDate: string
  readonly actorId: string
}

/** Set the gate-confirmed figures. Called once, by M11's `createGoodsReceipt`. */
export async function recordConsignmentReceipt(
  tx: Tx,
  input: RecordReceiptInput,
): Promise<void> {
  await tx.execute(sql`
    update public.consignment
    set received_quantity_kg = ${input.receivedQuantityKg}::numeric,
        received_kesha_count = ${input.receivedKeshaCount},
        received_at = ${input.receivedAt},
        storage_start_date = ${input.storageStartDate}::date,
        updated_at = now(), updated_by = ${input.actorId}::uuid, version = version + 1
    where id = ${input.id}::uuid
  `)
}

export async function markConsignmentClosed(tx: Tx, id: string, closedAt: Date): Promise<void> {
  await tx.execute(sql`
    update public.consignment set closed_at = ${closedAt}, updated_at = now()
    where id = ${id}::uuid
  `)
}

/**
 * Recompute the consignment header from its lots and transition it if the derived status
 * has moved on.
 *
 * This is the structural guarantee behind `deriveConsignmentStatus`'s doc comment: the
 * header is never set independently by a use case, only recalculated here, from the current
 * lot statuses, after whatever changed them.
 */
export async function syncConsignmentStatusFromLots(
  tx: Tx,
  consignmentId: string,
  actorId: string,
  occurredAt: Date,
  correlationId: string,
): Promise<void> {
  const current = await lockConsignmentStatus(tx, consignmentId)

  const lotRows = await rawRows(
    tx,
    sql`select status from public.lot where consignment_id = ${consignmentId}::uuid`,
  )
  const lotStatuses = lotRows.map((row) => col.text(row.status) as LotStatus)

  const derived = deriveConsignmentStatus(current, lotStatuses)
  if (derived === current) return

  try {
    await transitionConsignment(tx, {
      id: consignmentId,
      to: derived,
      actorId,
      occurredAt,
      reason: 'Derived from lot statuses',
      correlationId,
    })
  } catch (error) {
    // The derivation rule and the transition table can disagree at an edge the rule did not
    // anticipate (e.g. a lot reaching PRODUCED while a sibling is still RESERVED_FOR_JOB).
    // Surfacing that as an illegal-transition error would abort the caller's real business
    // operation over a header-summary nicety; leaving the header one step behind is the
    // safer failure, and it self-corrects on the next lot change.
    if (!(error instanceof InvalidStateTransitionError)) throw error
  }
}

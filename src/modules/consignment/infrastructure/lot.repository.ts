import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { publishEvents } from '@modules/audit'
import { lotStateMachine, type LotStatus } from '../domain/consignment.state-machine'
import { lotStatusChanged, lotCreated } from '../domain/events'

/**
 * Lot writes — split out of `consignment.repository.ts` to keep each file under the
 * project's line ceiling, not because the two are independent: a lot always belongs to a
 * consignment, and `syncConsignmentStatusFromLots` (in the sibling file) is what keeps the
 * header honest after a write here.
 */

export interface CreateLotInput {
  readonly consignmentId: string
  readonly customerId: string
  readonly coffeeTypeId?: string | null
  readonly coffeeGradeId?: string | null
  readonly bagTypeId?: string | null
  readonly outputClassificationId?: string | null
  readonly initialQuantityKg: string
  readonly initialKeshaCount: number
  readonly storageStartDate?: string | null
  readonly actorId: string
  readonly occurredAt: Date
  readonly correlationId: string
  /**
   * IN_STORE for a received lot (the default); PRODUCED for a processing output. The two
   * are the only legal CREATION states — `LOT_TRANSITIONS` has no edge INTO PRODUCED, so a
   * job's output lot must be born there rather than created IN_STORE and transitioned.
   */
  readonly initialStatus?: 'IN_STORE' | 'PRODUCED'
}

export async function createLot(
  tx: Tx,
  input: CreateLotInput,
): Promise<{ id: string; reference: string }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.LOT, {
    actorId: input.actorId,
  })
  const status = input.initialStatus ?? 'IN_STORE'

  await tx.execute(sql`
    insert into public.lot (
      id, reference, consignment_id, customer_id, status,
      coffee_type_id, coffee_grade_id, bag_type_id, output_classification_id,
      initial_quantity_kg, initial_kesha_count, storage_start_date,
      created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.consignmentId}::uuid, ${input.customerId}::uuid,
      ${status},
      ${input.coffeeTypeId ?? null}::uuid, ${input.coffeeGradeId ?? null}::uuid,
      ${input.bagTypeId ?? null}::uuid, ${input.outputClassificationId ?? null}::uuid,
      ${input.initialQuantityKg}::numeric, ${input.initialKeshaCount},
      ${input.storageStartDate ?? null}::date,
      ${input.actorId}::uuid, now(), now()
    )
  `)

  await publishEvents(
    tx,
    [
      lotCreated({
        aggregateId: id,
        actorId: input.actorId,
        occurredAt: input.occurredAt,
        payload: {
          reference: allocated.formatted,
          consignmentId: input.consignmentId,
          customerId: input.customerId,
          initialQuantityKg: input.initialQuantityKg,
          initialKeshaCount: input.initialKeshaCount,
          outputClassificationId: input.outputClassificationId ?? null,
        },
      }),
    ],
    { correlationId: input.correlationId },
  )

  return { id, reference: allocated.formatted }
}

async function lockLotStatus(tx: Tx, id: string): Promise<LotStatus> {
  const rows = await rawRows(
    tx,
    sql`select status from public.lot where id = ${id}::uuid for update`,
  )
  const row = rows[0]
  if (!row) throw new Error(`Lot ${id} not found`)
  return col.text(row.status) as LotStatus
}

export interface TransitionLotInput {
  readonly id: string
  readonly to: LotStatus
  readonly actorId: string
  readonly occurredAt: Date
  readonly reason?: string | null
  readonly correlationId: string
}

export async function transitionLot(tx: Tx, input: TransitionLotInput): Promise<void> {
  const from = await lockLotStatus(tx, input.id)

  lotStateMachine.assert(from, input.to)

  await tx.execute(sql`
    update public.lot
    set status = ${input.to}, updated_at = now(), updated_by = ${input.actorId}::uuid,
        version = version + 1
    where id = ${input.id}::uuid
  `)

  await tx.execute(sql`
    insert into public.lot_status_history (
      id, lot_id, from_status, to_status, occurred_at, actor_id, reason
    ) values (
      ${uuidv7()}, ${input.id}::uuid, ${from}, ${input.to}, ${input.occurredAt},
      ${input.actorId}::uuid, ${input.reason ?? null}
    )
  `)

  const referenceRow = await rawRows(
    tx,
    sql`select reference, consignment_id from public.lot where id = ${input.id}::uuid`,
  )
  const reference = referenceRow[0] ? col.text(referenceRow[0].reference) : input.id
  const consignmentId = referenceRow[0] ? col.text(referenceRow[0].consignment_id) : ''

  await publishEvents(
    tx,
    [
      lotStatusChanged({
        aggregateId: input.id,
        actorId: input.actorId,
        occurredAt: input.occurredAt,
        payload: {
          reference,
          consignmentId,
          fromStatus: from,
          toStatus: input.to,
          reason: input.reason ?? null,
        },
      }),
    ],
    { correlationId: input.correlationId },
  )
}

/** Current placement, upserted — a lot moved by a transfer stays one row per location. */
export async function upsertLotPlacement(
  tx: Tx,
  lotId: string,
  locationId: string,
  placedAt: Date,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into public.lot_placement (lot_id, location_id, placed_at, created_by, created_at, updated_at)
    values (${lotId}::uuid, ${locationId}::uuid, ${placedAt}, ${actorId}::uuid, now(), now())
    on conflict (lot_id, location_id) do update
      set placed_at = excluded.placed_at, updated_at = now(), updated_by = ${actorId}::uuid
  `)
}

export async function removeLotPlacement(
  tx: Tx,
  lotId: string,
  locationId: string,
): Promise<void> {
  await tx.execute(sql`
    delete from public.lot_placement where lot_id = ${lotId}::uuid and location_id = ${locationId}::uuid
  `)
}

/** Link an output lot to the lot(s) it was produced from. */
export async function addLotLineage(
  tx: Tx,
  parentLotId: string,
  childLotId: string,
  jobOrderId: string | null,
): Promise<void> {
  await tx.execute(sql`
    insert into public.lot_lineage (parent_lot_id, child_lot_id, job_order_id, created_at)
    values (${parentLotId}::uuid, ${childLotId}::uuid, ${jobOrderId}::uuid, now())
    on conflict do nothing
  `)
}

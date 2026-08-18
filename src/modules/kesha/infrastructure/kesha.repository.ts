import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

/**
 * M13 writes. Same shape as the stock ledger: `kesha_movement` is append-only and the
 * source of truth; `kesha_balance` is a projection upserted in the same statement.
 */

export type KeshaMovementType =
  | 'RECEIVED_FULL'
  | 'EMPTIED'
  | 'REFILLED'
  | 'RETURNED_EMPTY'
  | 'RETURNED_FULL'
  | 'DAMAGED'
  | 'RETAINED'
  | 'ADJUSTMENT'

export interface PostKeshaMovementInput {
  readonly branchId: string
  readonly customerId: string
  readonly consignmentId: string | null
  readonly bagTypeId: string | null
  readonly locationId: string | null
  readonly movementType: KeshaMovementType
  readonly keshaDelta: number
  readonly condition: 'GOOD' | 'DAMAGED' | 'UNUSABLE'
  readonly sourceType: string
  readonly sourceId: string
  readonly reasonCode: string | null
  readonly note: string | null
  readonly occurredAt: Date
  readonly actorId: string
}

/** Which balance bucket a movement type affects — `heldFull`/`heldEmpty`/`damaged`/`returned`. */
function bucketDeltaFor(
  type: KeshaMovementType,
  delta: number,
): {
  heldFull: number
  heldEmpty: number
  damaged: number
  returned: number
} {
  switch (type) {
    case 'RECEIVED_FULL':
      return { heldFull: delta, heldEmpty: 0, damaged: 0, returned: 0 }
    case 'EMPTIED':
      return { heldFull: -Math.abs(delta), heldEmpty: Math.abs(delta), damaged: 0, returned: 0 }
    case 'REFILLED':
      return { heldFull: Math.abs(delta), heldEmpty: -Math.abs(delta), damaged: 0, returned: 0 }
    case 'RETURNED_EMPTY':
      return { heldFull: 0, heldEmpty: -Math.abs(delta), damaged: 0, returned: Math.abs(delta) }
    case 'RETURNED_FULL':
      return { heldFull: -Math.abs(delta), heldEmpty: 0, damaged: 0, returned: Math.abs(delta) }
    case 'DAMAGED':
      return { heldFull: 0, heldEmpty: -Math.abs(delta), damaged: Math.abs(delta), returned: 0 }
    case 'RETAINED':
      return { heldFull: 0, heldEmpty: -Math.abs(delta), damaged: 0, returned: 0 }
    case 'ADJUSTMENT':
      return { heldFull: delta, heldEmpty: 0, damaged: 0, returned: 0 }
  }
}

export async function postKeshaMovement(
  tx: Tx,
  input: PostKeshaMovementInput,
): Promise<string> {
  const id = uuidv7()

  await tx.execute(sql`
    insert into public.kesha_movement (
      id, branch_id, customer_id, consignment_id, bag_type_id, location_id,
      movement_type, kesha_delta, condition, source_type, source_id, reason_code, note,
      occurred_at, recorded_at, created_by, created_at
    ) values (
      ${id}, ${input.branchId}::uuid, ${input.customerId}::uuid, ${input.consignmentId}::uuid,
      ${input.bagTypeId}::uuid, ${input.locationId}::uuid,
      ${input.movementType}, ${input.keshaDelta}, ${input.condition},
      ${input.sourceType}, ${input.sourceId}::uuid, ${input.reasonCode}, ${input.note},
      ${input.occurredAt}, now(), ${input.actorId}::uuid, now()
    )
  `)

  const bucket = bucketDeltaFor(input.movementType, input.keshaDelta)

  await tx.execute(sql`
    insert into public.kesha_balance (
      id, customer_id, bag_type_id, branch_id, held_full, held_empty, damaged, returned,
      last_movement_at, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${input.customerId}::uuid, ${input.bagTypeId}::uuid, ${input.branchId}::uuid,
      ${Math.max(bucket.heldFull, 0)}, ${Math.max(bucket.heldEmpty, 0)},
      ${Math.max(bucket.damaged, 0)}, ${Math.max(bucket.returned, 0)},
      ${input.occurredAt}, ${input.actorId}::uuid, now(), now()
    )
    on conflict (customer_id, bag_type_id, branch_id) do update set
      held_full = greatest(public.kesha_balance.held_full + ${bucket.heldFull}, 0),
      held_empty = greatest(public.kesha_balance.held_empty + ${bucket.heldEmpty}, 0),
      damaged = greatest(public.kesha_balance.damaged + ${bucket.damaged}, 0),
      returned = greatest(public.kesha_balance.returned + ${bucket.returned}, 0),
      last_movement_at = excluded.last_movement_at, updated_at = now(), version = public.kesha_balance.version + 1
  `)

  return id
}

export interface KeshaBalanceRow {
  readonly heldFull: number
  readonly heldEmpty: number
  readonly damaged: number
  readonly returned: number
}

export async function keshaBalanceFor(
  tx: Tx,
  customerId: string,
  bagTypeId: string | null,
  branchId: string,
): Promise<KeshaBalanceRow> {
  const rows = await rawRows(
    tx,
    sql`
      select held_full, held_empty, damaged, returned from public.kesha_balance
      where customer_id = ${customerId}::uuid and bag_type_id is not distinct from ${bagTypeId}::uuid
        and branch_id = ${branchId}::uuid
    `,
  )
  const row = rows[0]
  if (!row) return { heldFull: 0, heldEmpty: 0, damaged: 0, returned: 0 }
  return {
    heldFull: col.int(row.held_full),
    heldEmpty: col.int(row.held_empty),
    damaged: col.int(row.damaged),
    returned: col.int(row.returned),
  }
}

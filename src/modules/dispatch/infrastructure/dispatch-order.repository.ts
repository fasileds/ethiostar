import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { dispatchOrderStateMachine, type DispatchOrderStatus } from '../domain/dispatch-status'

export interface CreateDispatchOrderInput {
  readonly branchId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly releaseRequestId: string
  readonly plannedQuantityKg: string
  readonly plannedKeshaCount: number | null
  readonly vehiclePlate: string | null
  readonly driverName: string | null
  readonly transporterName: string | null
  readonly destination: string | null
  readonly actorId: string
}

export async function createDispatchOrder(
  tx: Tx,
  input: CreateDispatchOrderInput,
): Promise<{ id: string; reference: string }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.DISPATCH_NOTE, {
    branchId: input.branchId,
    actorId: input.actorId,
  })

  await tx.execute(sql`
    insert into public.dispatch_order (
      id, reference, branch_id, customer_id, consignment_id, release_request_id, status,
      planned_quantity_kg, planned_kesha_count, vehicle_plate, driver_name, transporter_name,
      destination, created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.branchId}::uuid, ${input.customerId}::uuid,
      ${input.consignmentId}::uuid, ${input.releaseRequestId}::uuid, 'PLANNED',
      ${input.plannedQuantityKg}::numeric, ${input.plannedKeshaCount},
      ${input.vehiclePlate}, ${input.driverName}, ${input.transporterName}, ${input.destination},
      ${input.actorId}::uuid, now(), now()
    )
  `)

  return { id, reference: allocated.formatted }
}

interface DispatchOrderHeader {
  readonly status: DispatchOrderStatus
  readonly reference: string
  readonly branchId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly releaseRequestId: string | null
  readonly vehiclePlate: string | null
  readonly clearanceStatus: string | null
}

export async function lockDispatchOrder(tx: Tx, id: string): Promise<DispatchOrderHeader> {
  const rows = await rawRows(
    tx,
    sql`
      select status, reference, branch_id, customer_id, consignment_id, release_request_id,
             vehicle_plate, clearance_status
      from public.dispatch_order where id = ${id}::uuid for update
    `,
  )
  const row = rows[0]
  if (!row) throw new Error(`Dispatch order ${id} not found`)
  return {
    status: col.text(row.status) as DispatchOrderStatus,
    reference: col.text(row.reference),
    branchId: col.text(row.branch_id),
    customerId: col.text(row.customer_id),
    consignmentId: col.text(row.consignment_id),
    releaseRequestId: col.textOrNull(row.release_request_id),
    vehiclePlate: col.textOrNull(row.vehicle_plate),
    clearanceStatus: col.textOrNull(row.clearance_status),
  }
}

export async function transitionDispatchOrder(
  tx: Tx,
  id: string,
  from: DispatchOrderStatus,
  to: DispatchOrderStatus,
): Promise<void> {
  dispatchOrderStateMachine.assert(from, to)

  const extra =
    to === 'DISPATCHED'
      ? sql`, gate_out_at = now(), dispatched_at = now()`
      : to === 'LOADED'
        ? sql`, loading_completed_at = now()`
        : to === 'LOADING'
          ? sql`, loading_started_at = now()`
          : sql``

  await tx.execute(sql`
    update public.dispatch_order set status = ${to}, updated_at = now() ${extra}
    where id = ${id}::uuid
  `)

  await tx.execute(sql`
    insert into public.dispatch_status_history (
      id, dispatch_order_id, from_status, to_status, changed_at
    ) values (${uuidv7()}, ${id}::uuid, ${from}, ${to}, now())
  `)
}

export interface DispatchLineInput {
  readonly lotId: string
  readonly locationId: string
  readonly bagTypeId: string | null
  readonly quantityKg: string
  readonly keshaCount: number
}

export async function insertDispatchLine(
  tx: Tx,
  dispatchOrderId: string,
  lineNo: number,
  line: DispatchLineInput,
  stockMovementId: string | null,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into public.dispatch_line (
      id, dispatch_order_id, line_no, lot_id, location_id, bag_type_id, quantity_kg, kesha_count,
      stock_movement_id, loaded_at, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${dispatchOrderId}::uuid, ${lineNo}, ${line.lotId}::uuid, ${line.locationId}::uuid,
      ${line.bagTypeId}::uuid, ${line.quantityKg}::numeric, ${line.keshaCount},
      ${stockMovementId}::uuid, ${stockMovementId ? sql`now()` : sql`null`},
      ${actorId}::uuid, now(), now()
    )
  `)
}

export async function dispatchLinesFor(
  tx: Tx,
  dispatchOrderId: string,
): Promise<
  Array<{
    id: string
    lotId: string
    locationId: string
    bagTypeId: string | null
    quantityKg: string
    keshaCount: number
  }>
> {
  const rows = await rawRows(
    tx,
    sql`select id, lot_id, location_id, bag_type_id, quantity_kg, kesha_count from public.dispatch_line where dispatch_order_id = ${dispatchOrderId}::uuid order by line_no`,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    lotId: col.text(row.lot_id),
    locationId: col.text(row.location_id),
    bagTypeId: col.textOrNull(row.bag_type_id),
    quantityKg: col.numeric(row.quantity_kg),
    keshaCount: col.int(row.kesha_count),
  }))
}

export async function setLoadedTotals(
  tx: Tx,
  id: string,
  loadedQuantityKg: string,
  loadedKeshaCount: number,
): Promise<void> {
  await tx.execute(sql`
    update public.dispatch_order
    set loaded_quantity_kg = ${loadedQuantityKg}::numeric, loaded_kesha_count = ${loadedKeshaCount},
        updated_at = now()
    where id = ${id}::uuid
  `)
}

export interface SetClearanceInput {
  readonly status: 'CLEARED' | 'BLOCKED'
  readonly note: string | null
  readonly checkedBy: string
  readonly overrideApprovedBy: string | null
  readonly overrideReason: string | null
}

export async function setClearance(
  tx: Tx,
  id: string,
  input: SetClearanceInput,
): Promise<void> {
  await tx.execute(sql`
    update public.dispatch_order
    set clearance_status = ${input.status}, clearance_checked_at = now(),
        clearance_checked_by = ${input.checkedBy}::uuid, clearance_note = ${input.note},
        override_approved_by = ${input.overrideApprovedBy}::uuid, override_reason = ${input.overrideReason},
        updated_at = now()
    where id = ${id}::uuid
  `)
}

/**
 * The gate-out itself, as a single conditional UPDATE — the M17 key control ("no vehicle
 * leaves without a valid, unused pass") made atomic. Two officers scanning the same order
 * concurrently can both attempt this; the `WHERE` clause means only one `UPDATE` matches a
 * row, so only one actually transitions GATE_CLEARED → DISPATCHED.
 */
export async function tryRecordGateOut(tx: Tx, id: string): Promise<boolean> {
  const rows = await rawRows(
    tx,
    sql`
      update public.dispatch_order
      set status = 'DISPATCHED', gate_out_at = now(), dispatched_at = now(), updated_at = now()
      where id = ${id}::uuid and status = 'GATE_CLEARED' and clearance_status = 'CLEARED'
      returning id
    `,
  )
  return rows.length > 0
}

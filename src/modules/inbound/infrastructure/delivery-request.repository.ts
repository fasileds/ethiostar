import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import {
  deliveryRequestStateMachine,
  type DeliveryRequestStatus,
} from '../domain/delivery-request-status'

export interface CreateDeliveryRequestInput {
  readonly branchId: string
  readonly customerId: string
  readonly coffeeTypeId?: string | null
  readonly coffeeGradeId?: string | null
  readonly originWoredaId?: string | null
  readonly harvestYearId?: string | null
  readonly bagTypeId?: string | null
  readonly declaredQuantityKg: string
  readonly declaredKeshaCount: number
  readonly expectedArrivalOn: string
  readonly expectedArrivalWindow?: string | null
  readonly transportMode?: string | null
  readonly vehiclePlate?: string | null
  readonly driverName?: string | null
  readonly driverPhone?: string | null
  readonly requestLetterFileId?: string | null
  readonly notes?: string | null
  readonly actorId: string
}

export async function insertDeliveryRequest(
  tx: Tx,
  input: CreateDeliveryRequestInput,
): Promise<{ id: string; reference: string }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.DELIVERY_REQUEST, {
    branchId: input.branchId,
    actorId: input.actorId,
  })

  await tx.execute(sql`
    insert into public.delivery_request (
      id, reference, branch_id, customer_id, status,
      coffee_type_id, coffee_grade_id, origin_woreda_id, harvest_year_id, bag_type_id,
      declared_quantity_kg, declared_kesha_count, expected_arrival_on, expected_arrival_window,
      transport_mode, vehicle_plate, driver_name, driver_phone, request_letter_file_id,
      submitted_at, notes, created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.branchId}::uuid, ${input.customerId}::uuid, 'SUBMITTED',
      ${input.coffeeTypeId ?? null}::uuid, ${input.coffeeGradeId ?? null}::uuid,
      ${input.originWoredaId ?? null}::uuid, ${input.harvestYearId ?? null}::uuid,
      ${input.bagTypeId ?? null}::uuid,
      ${input.declaredQuantityKg}::numeric, ${input.declaredKeshaCount},
      ${input.expectedArrivalOn}::date, ${input.expectedArrivalWindow ?? null},
      ${input.transportMode ?? null}, ${input.vehiclePlate ?? null}, ${input.driverName ?? null},
      ${input.driverPhone ?? null}, ${input.requestLetterFileId ?? null}::uuid,
      now(), ${input.notes ?? null}, ${input.actorId}::uuid, now(), now()
    )
  `)

  return { id, reference: allocated.formatted }
}

interface DeliveryRequestHeader {
  readonly status: DeliveryRequestStatus
  readonly reference: string
  readonly branchId: string
  readonly branchName: string | null
  readonly customerId: string
  readonly declaredQuantityKg: string
  readonly declaredKeshaCount: number
  readonly coffeeTypeId: string | null
  readonly coffeeGradeId: string | null
  readonly bagTypeId: string | null
  readonly consignmentId: string | null
  readonly consignmentReference: string | null
}

export async function lockDeliveryRequest(tx: Tx, id: string): Promise<DeliveryRequestHeader> {
  const rows = await rawRows(
    tx,
    sql`
      select r.status, r.reference, r.branch_id, b.name_en as branch_name,
             r.customer_id, r.declared_quantity_kg, r.declared_kesha_count,
             r.coffee_type_id, r.coffee_grade_id, r.bag_type_id, r.consignment_id,
             c.reference as consignment_reference
      from public.delivery_request r
      left join public.branch b on b.id = r.branch_id
      left join public.consignment c on c.id = r.consignment_id
      where r.id = ${id}::uuid
      for update of r
    `,
  )
  const row = rows[0]
  if (!row) throw new Error(`Delivery request ${id} not found`)
  return {
    status: col.text(row.status) as DeliveryRequestStatus,
    reference: col.text(row.reference),
    branchId: col.text(row.branch_id),
    branchName: col.textOrNull(row.branch_name),
    customerId: col.text(row.customer_id),
    declaredQuantityKg: col.numeric(row.declared_quantity_kg),
    declaredKeshaCount: col.int(row.declared_kesha_count),
    coffeeTypeId: col.textOrNull(row.coffee_type_id),
    coffeeGradeId: col.textOrNull(row.coffee_grade_id),
    bagTypeId: col.textOrNull(row.bag_type_id),
    consignmentId: col.textOrNull(row.consignment_id),
    consignmentReference: col.textOrNull(row.consignment_reference),
  }
}

export async function transitionDeliveryRequest(
  tx: Tx,
  id: string,
  from: DeliveryRequestStatus,
  to: DeliveryRequestStatus,
  actorId: string,
  note?: string | null,
): Promise<void> {
  deliveryRequestStateMachine.assert(from, to)

  await tx.execute(sql`
    update public.delivery_request
    set status = ${to}, updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${id}::uuid
  `)

  await tx.execute(sql`
    insert into public.delivery_request_status_history (
      id, delivery_request_id, from_status, to_status, note, changed_at, changed_by
    ) values (${uuidv7()}, ${id}::uuid, ${from}, ${to}, ${note ?? null}, now(), ${actorId}::uuid)
  `)
}

export async function approveDeliveryRequestRow(
  tx: Tx,
  id: string,
  actorId: string,
  reservationId: string,
  consignmentId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.delivery_request
    set approved_by = ${actorId}::uuid, approved_at = now(),
        reservation_id = ${reservationId}::uuid, consignment_id = ${consignmentId}::uuid,
        updated_at = now()
    where id = ${id}::uuid
  `)
}

export async function rejectDeliveryRequestRow(
  tx: Tx,
  id: string,
  reason: string,
): Promise<void> {
  await tx.execute(sql`
    update public.delivery_request set rejection_reason = ${reason}, updated_at = now()
    where id = ${id}::uuid
  `)
}

export async function cancelDeliveryRequestRow(
  tx: Tx,
  id: string,
  reason: string,
  cancelledAt: Date,
): Promise<void> {
  await tx.execute(sql`
    update public.delivery_request
    set cancelled_reason = ${reason}, cancelled_at = ${cancelledAt}, updated_at = now()
    where id = ${id}::uuid
  `)
}

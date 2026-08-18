import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import {
  releaseRequestStateMachine,
  type ReleaseRequestStatus,
} from '../domain/dispatch-status'

export interface CreateReleaseRequestInput {
  readonly branchId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly requestedQuantityKg: string
  readonly requestedKeshaCount: number | null
  readonly requestedCollectionOn: string | null
  readonly authorisedByContactId: string | null
  readonly collectorName: string | null
  readonly collectorIdNo: string | null
  readonly collectorPhone: string | null
  readonly vehiclePlate: string | null
  readonly notes: string | null
  readonly actorId: string
}

export async function insertReleaseRequest(
  tx: Tx,
  input: CreateReleaseRequestInput,
): Promise<{ id: string; reference: string }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.RELEASE_REQUEST, {
    branchId: input.branchId,
    actorId: input.actorId,
  })

  await tx.execute(sql`
    insert into public.release_request (
      id, reference, branch_id, customer_id, consignment_id, status,
      requested_quantity_kg, requested_kesha_count, requested_collection_on,
      authorised_by_contact_id, collector_name, collector_id_no, collector_phone, vehicle_plate,
      submitted_at, notes, created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.branchId}::uuid, ${input.customerId}::uuid,
      ${input.consignmentId}::uuid, 'SUBMITTED',
      ${input.requestedQuantityKg}::numeric, ${input.requestedKeshaCount},
      ${input.requestedCollectionOn}::date, ${input.authorisedByContactId}::uuid,
      ${input.collectorName}, ${input.collectorIdNo}, ${input.collectorPhone}, ${input.vehiclePlate},
      now(), ${input.notes}, ${input.actorId}::uuid, now(), now()
    )
  `)

  return { id, reference: allocated.formatted }
}

interface ReleaseRequestHeader {
  readonly status: ReleaseRequestStatus
  readonly reference: string
  readonly branchId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly requestedQuantityKg: string
  readonly requestedKeshaCount: number | null
  readonly vehiclePlate: string | null
}

export async function lockReleaseRequest(tx: Tx, id: string): Promise<ReleaseRequestHeader> {
  const rows = await rawRows(
    tx,
    sql`
      select status, reference, branch_id, customer_id, consignment_id,
             requested_quantity_kg, requested_kesha_count, vehicle_plate
      from public.release_request where id = ${id}::uuid for update
    `,
  )
  const row = rows[0]
  if (!row) throw new Error(`Release request ${id} not found`)
  return {
    status: col.text(row.status) as ReleaseRequestStatus,
    reference: col.text(row.reference),
    branchId: col.text(row.branch_id),
    customerId: col.text(row.customer_id),
    consignmentId: col.text(row.consignment_id),
    requestedQuantityKg: col.numeric(row.requested_quantity_kg),
    requestedKeshaCount: col.intOrNull(row.requested_kesha_count),
    vehiclePlate: col.textOrNull(row.vehicle_plate),
  }
}

export async function transitionReleaseRequest(
  tx: Tx,
  id: string,
  from: ReleaseRequestStatus,
  to: ReleaseRequestStatus,
  extra?: { rejectionReason?: string },
): Promise<void> {
  releaseRequestStateMachine.assert(from, to)

  const set =
    to === 'APPROVED'
      ? sql`, approved_at = now()`
      : to === 'REJECTED'
        ? sql`, rejection_reason = ${extra?.rejectionReason ?? null}`
        : sql``

  await tx.execute(sql`
    update public.release_request set status = ${to}, updated_at = now() ${set}
    where id = ${id}::uuid
  `)
}

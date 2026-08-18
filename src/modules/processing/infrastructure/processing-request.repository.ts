import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { defineStateMachine, type TransitionTable } from '@core/domain/state-machine'

export const PROCESSING_REQUEST_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED',
] as const
export type ProcessingRequestStatus = (typeof PROCESSING_REQUEST_STATUSES)[number]

const TRANSITIONS: TransitionTable<ProcessingRequestStatus> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['SCHEDULED', 'CANCELLED'],
  REJECTED: [],
  SCHEDULED: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
}

export const processingRequestStateMachine = defineStateMachine<ProcessingRequestStatus>(
  'processing_request',
  TRANSITIONS,
)

export interface CreateProcessingRequestInput {
  readonly branchId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly serviceType: string
  readonly requestedQuantityKg: string
  readonly requestedKeshaCount: number | null
  readonly outputSpecification: string | null
  readonly preferredStartOn: string | null
  readonly urgency: 'LOW' | 'NORMAL' | 'HIGH'
  readonly notes: string | null
  readonly actorId: string
}

export async function insertProcessingRequest(
  tx: Tx,
  input: CreateProcessingRequestInput,
): Promise<{ id: string; reference: string }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.PROCESSING_REQUEST, {
    branchId: input.branchId,
    actorId: input.actorId,
  })

  await tx.execute(sql`
    insert into public.processing_request (
      id, reference, branch_id, customer_id, consignment_id, status,
      service_type, requested_quantity_kg, requested_kesha_count, output_specification,
      preferred_start_on, urgency, submitted_at, notes,
      created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.branchId}::uuid, ${input.customerId}::uuid,
      ${input.consignmentId}::uuid, 'SUBMITTED',
      ${input.serviceType}, ${input.requestedQuantityKg}::numeric, ${input.requestedKeshaCount},
      ${input.outputSpecification}, ${input.preferredStartOn}::date, ${input.urgency}, now(),
      ${input.notes}, ${input.actorId}::uuid, now(), now()
    )
  `)

  return { id, reference: allocated.formatted }
}

interface ProcessingRequestHeader {
  readonly status: ProcessingRequestStatus
  readonly reference: string
  readonly branchId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly consignmentReference: string | null
  readonly serviceType: string
  readonly requestedQuantityKg: string
  readonly requestedKeshaCount: number | null
}

export async function lockProcessingRequest(
  tx: Tx,
  id: string,
): Promise<ProcessingRequestHeader> {
  const rows = await rawRows(
    tx,
    sql`
      select p.status, p.reference, p.branch_id, p.customer_id, p.consignment_id,
             c.reference as consignment_reference,
             p.service_type, p.requested_quantity_kg, p.requested_kesha_count
      from public.processing_request p
      left join public.consignment c on c.id = p.consignment_id
      where p.id = ${id}::uuid
      for update of p
    `,
  )
  const row = rows[0]
  if (!row) throw new Error(`Processing request ${id} not found`)
  return {
    status: col.text(row.status) as ProcessingRequestStatus,
    reference: col.text(row.reference),
    branchId: col.text(row.branch_id),
    customerId: col.text(row.customer_id),
    consignmentId: col.text(row.consignment_id),
    consignmentReference: col.textOrNull(row.consignment_reference),
    serviceType: col.text(row.service_type),
    requestedQuantityKg: col.numeric(row.requested_quantity_kg),
    requestedKeshaCount: col.intOrNull(row.requested_kesha_count),
  }
}

export async function transitionProcessingRequest(
  tx: Tx,
  id: string,
  from: ProcessingRequestStatus,
  to: ProcessingRequestStatus,
  actorId: string,
  extra?: { rejectionReason?: string; appointmentId?: string },
): Promise<void> {
  processingRequestStateMachine.assert(from, to)

  const setClauses =
    to === 'APPROVED'
      ? sql`, approved_by = ${actorId}::uuid, approved_at = now()`
      : to === 'REJECTED'
        ? sql`, rejection_reason = ${extra?.rejectionReason ?? null}`
        : to === 'SCHEDULED' && extra?.appointmentId
          ? sql`, appointment_id = ${extra.appointmentId}::uuid`
          : sql``

  await tx.execute(sql`
    update public.processing_request
    set status = ${to}, updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    ${setClauses}
    where id = ${id}::uuid
  `)
}

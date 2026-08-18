import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { jobOrderStateMachine, type JobOrderStatus } from '../domain/job-order-status'

export interface CreateJobOrderInput {
  readonly branchId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly processingRequestId: string | null
  readonly appointmentId: string | null
  readonly machineId: string | null
  readonly serviceType: string
  readonly plannedInputKg: string
  readonly plannedKeshaCount: number | null
  readonly scheduledStartAt: Date | null
  readonly actorId: string
}

export async function insertJobOrder(
  tx: Tx,
  input: CreateJobOrderInput,
): Promise<{ id: string; reference: string }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.JOB_ORDER, {
    branchId: input.branchId,
    actorId: input.actorId,
  })

  await tx.execute(sql`
    insert into public.job_order (
      id, reference, branch_id, customer_id, consignment_id, processing_request_id,
      appointment_id, machine_id, status, service_type, planned_input_kg, planned_kesha_count,
      scheduled_start_at, created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.branchId}::uuid, ${input.customerId}::uuid,
      ${input.consignmentId}::uuid, ${input.processingRequestId}::uuid, ${input.appointmentId}::uuid,
      ${input.machineId}::uuid, 'PLANNED', ${input.serviceType},
      ${input.plannedInputKg}::numeric, ${input.plannedKeshaCount}, ${input.scheduledStartAt},
      ${input.actorId}::uuid, now(), now()
    )
  `)

  return { id, reference: allocated.formatted }
}

interface JobOrderHeader {
  readonly status: JobOrderStatus
  readonly reference: string
  readonly branchId: string
  readonly consignmentId: string
  readonly customerId: string
  readonly scheduledStartAt: Date | null
}

export async function lockJobOrder(tx: Tx, id: string): Promise<JobOrderHeader> {
  const rows = await rawRows(
    tx,
    sql`
      select status, reference, branch_id, consignment_id, customer_id, scheduled_start_at
      from public.job_order where id = ${id}::uuid for update
    `,
  )
  const row = rows[0]
  if (!row) throw new Error(`Job order ${id} not found`)
  return {
    status: col.text(row.status) as JobOrderStatus,
    reference: col.text(row.reference),
    branchId: col.text(row.branch_id),
    consignmentId: col.text(row.consignment_id),
    customerId: col.text(row.customer_id),
    scheduledStartAt: col.dateOrNull(row.scheduled_start_at),
  }
}

export async function transitionJobOrder(
  tx: Tx,
  id: string,
  from: JobOrderStatus,
  to: JobOrderStatus,
  actorId: string,
  note?: string | null,
): Promise<void> {
  jobOrderStateMachine.assert(from, to)

  const timestampColumn =
    to === 'IN_PROGRESS'
      ? sql`, started_at = coalesce(started_at, now())`
      : to === 'PAUSED'
        ? sql`, paused_at = now()`
        : to === 'COMPLETED'
          ? sql`, completed_at = now()`
          : to === 'CLOSED'
            ? sql`, closed_at = now()`
            : to === 'CANCELLED'
              ? sql`, cancelled_at = now(), cancelled_reason = ${note ?? null}`
              : sql``

  await tx.execute(sql`
    update public.job_order
    set status = ${to}, updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    ${timestampColumn}
    where id = ${id}::uuid
  `)

  await tx.execute(sql`
    insert into public.job_order_status_history (
      id, job_order_id, from_status, to_status, note, changed_at, changed_by
    ) values (${uuidv7()}, ${id}::uuid, ${from}, ${to}, ${note ?? null}, now(), ${actorId}::uuid)
  `)
}

export interface JobInputLine {
  readonly lotId: string
  readonly locationId: string
  readonly quantityKg: string
  readonly keshaCount: number | null
  readonly coffeeTypeId: string | null
  readonly coffeeGradeId: string | null
}

export async function insertJobOrderInput(
  tx: Tx,
  jobOrderId: string,
  lineNo: number,
  line: JobInputLine,
  stockMovementId: string,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into public.job_order_input (
      id, job_order_id, line_no, lot_id, location_id, quantity_kg, kesha_count,
      coffee_type_id, coffee_grade_id, stock_movement_id, issued_at,
      created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${jobOrderId}::uuid, ${lineNo}, ${line.lotId}::uuid, ${line.locationId}::uuid,
      ${line.quantityKg}::numeric, ${line.keshaCount}, ${line.coffeeTypeId}::uuid,
      ${line.coffeeGradeId}::uuid, ${stockMovementId}::uuid, now(),
      ${actorId}::uuid, now(), now()
    )
  `)
}

export interface JobOutputLine {
  readonly classificationId: string | null
  readonly isLoss: boolean
  readonly quantityKg: string
  readonly keshaCount: number | null
  readonly lotId: string | null
  readonly locationId: string | null
  readonly coffeeGradeId: string | null
  readonly notes: string | null
}

export async function insertJobOrderOutput(
  tx: Tx,
  jobOrderId: string,
  lineNo: number,
  line: JobOutputLine,
  percentOfInput: string | null,
  stockMovementId: string,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into public.job_order_output (
      id, job_order_id, line_no, classification_id, is_loss, quantity_kg, kesha_count,
      percent_of_input, lot_id, location_id, coffee_grade_id, stock_movement_id, produced_at,
      notes, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${jobOrderId}::uuid, ${lineNo}, ${line.classificationId}::uuid, ${line.isLoss},
      ${line.quantityKg}::numeric, ${line.keshaCount}, ${percentOfInput}::numeric,
      ${line.lotId}::uuid, ${line.locationId}::uuid, ${line.coffeeGradeId}::uuid,
      ${stockMovementId}::uuid, now(), ${line.notes},
      ${actorId}::uuid, now(), now()
    )
  `)
}

/** The lines recorded so far — read back inside the same transaction to compute the close. */
export async function loadJobLines(
  tx: Tx,
  jobOrderId: string,
): Promise<{
  inputs: Array<{ lotId: string; quantityKg: string }>
  outputs: Array<{
    classificationCode: string | null
    isLoss: boolean
    quantityKg: string
    keshaCount: number
    bagTypeId: string | null
    locationId: string | null
    reasonCodeId: string | null
  }>
}> {
  const inputRows = await rawRows(
    tx,
    sql`select lot_id, quantity_kg from public.job_order_input where job_order_id = ${jobOrderId}::uuid`,
  )
  const outputRows = await rawRows(
    tx,
    sql`
      select o.is_loss, o.quantity_kg, o.kesha_count, o.location_id, oc.code as classification_code
      from public.job_order_output o
      left join public.output_classification oc on oc.id = o.classification_id
      where o.job_order_id = ${jobOrderId}::uuid
    `,
  )

  return {
    inputs: inputRows.map((r) => ({
      lotId: col.text(r.lot_id),
      quantityKg: col.numeric(r.quantity_kg),
    })),
    outputs: outputRows.map((r) => ({
      classificationCode: col.textOrNull(r.classification_code),
      isLoss: col.bool(r.is_loss),
      quantityKg: col.numeric(r.quantity_kg),
      keshaCount: col.int(r.kesha_count),
      bagTypeId: null,
      locationId: col.textOrNull(r.location_id),
      reasonCodeId: null,
    })),
  }
}

export interface CloseJobFields {
  readonly actualInputKg: string
  readonly actualOutputKg: string
  readonly actualLossKg: string
  readonly yieldPct: string
  readonly lossPct: string
  readonly massBalanceStatus: 'BALANCED' | 'WITHIN_TOLERANCE' | 'EXCEPTION'
  readonly toleranceAppliedPct: string
  readonly varianceKg: string
  readonly varianceApprovedBy: string | null
  readonly varianceReason: string | null
}

export async function applyCloseFields(
  tx: Tx,
  jobOrderId: string,
  fields: CloseJobFields,
): Promise<void> {
  await tx.execute(sql`
    update public.job_order
    set actual_input_kg = ${fields.actualInputKg}::numeric,
        actual_output_kg = ${fields.actualOutputKg}::numeric,
        actual_loss_kg = ${fields.actualLossKg}::numeric,
        yield_pct = ${fields.yieldPct}::numeric,
        loss_pct = ${fields.lossPct}::numeric,
        mass_balance_status = ${fields.massBalanceStatus},
        tolerance_applied_pct = ${fields.toleranceAppliedPct}::numeric,
        variance_kg = ${fields.varianceKg}::numeric,
        variance_approved_by = ${fields.varianceApprovedBy}::uuid,
        variance_approved_at = ${fields.varianceApprovedBy ? sql`now()` : sql`null`},
        variance_reason = ${fields.varianceReason}
    where id = ${jobOrderId}::uuid
  `)
}

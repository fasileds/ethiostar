import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import {
  rawRows,
  col,
  listLimit,
  keysetBefore,
  toListPage,
  cursorValue,
  type ListPage,
} from '@db/helpers/list-query'

/**
 * M15 read models.
 *
 * Yields and loss percentages are read from the stored columns, not recomputed on display.
 * The figures were frozen against the tolerance in force when the job closed; recomputing
 * them here would silently restate a historic exception the day someone edits a tolerance.
 */

export interface JobOrderRow {
  readonly id: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly consignmentId: string
  readonly consignmentReference: string
  readonly machineName: string | null
  readonly status: string
  readonly serviceType: string
  readonly plannedInputKg: string
  readonly actualInputKg: string | null
  readonly actualOutputKg: string | null
  readonly actualLossKg: string | null
  readonly yieldPct: string | null
  readonly lossPct: string | null
  readonly massBalanceStatus: string | null
  readonly startedAt: Date | null
  readonly completedAt: Date | null
  readonly createdAt: Date
}

function toJobOrder(row: Record<string, unknown>): JobOrderRow {
  return {
    id: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    consignmentId: col.text(row.consignment_id),
    consignmentReference: col.text(row.consignment_reference),
    machineName: col.textOrNull(row.machine_name),
    status: col.text(row.status),
    serviceType: col.text(row.service_type),
    plannedInputKg: col.numeric(row.planned_input_kg),
    actualInputKg: col.numericOrNull(row.actual_input_kg),
    actualOutputKg: col.numericOrNull(row.actual_output_kg),
    actualLossKg: col.numericOrNull(row.actual_loss_kg),
    yieldPct: col.numericOrNull(row.yield_pct),
    lossPct: col.numericOrNull(row.loss_pct),
    massBalanceStatus: col.textOrNull(row.mass_balance_status),
    startedAt: col.dateOrNull(row.started_at),
    completedAt: col.dateOrNull(row.completed_at),
    createdAt: col.date(row.created_at),
  }
}

export async function listJobOrders(
  tx: Tx,
  filters: {
    status?: string | undefined
    search?: string | undefined
    customerId?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<JobOrderRow>> {
  const limit = listLimit(filters.limit)
  const search = filters.search?.trim()

  const rows = await rawRows(
    tx,
    sql`
      select
        j.*,
        cu.legal_name  as customer_name,
        cons.reference as consignment_reference,
        m.name_en      as machine_name
      from public.job_order j
      join public.customer cu    on cu.id = j.customer_id
      join public.consignment cons on cons.id = j.consignment_id
      left join public.machine m on m.id = j.machine_id
      where 1 = 1
        ${filters.status ? sql`and j.status = ${filters.status}` : sql``}
        ${filters.customerId ? sql`and j.customer_id = ${filters.customerId}::uuid` : sql``}
        ${
          search
            ? sql`and (j.reference ilike ${'%' + search + '%'}
                    or cons.reference ilike ${'%' + search + '%'}
                    or cu.legal_name ilike ${'%' + search + '%'})`
            : sql``
        }
        ${keysetBefore(sql`j.created_at`, sql`j.id`, filters.cursor)}
      order by j.created_at desc, j.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(rows.map(toJobOrder), limit, (row) => ({
    sortValue: cursorValue(row.createdAt),
    id: row.id,
  }))
}

export async function jobOrderStatusCounts(
  tx: Tx,
  customerId?: string,
): Promise<Readonly<Record<string, number>>> {
  const rows = await rawRows(
    tx,
    sql`
      select status, count(*)::int as total
      from public.job_order
      where 1 = 1 ${customerId ? sql`and customer_id = ${customerId}::uuid` : sql``}
      group by status
    `,
  )
  return Object.fromEntries(rows.map((row) => [col.text(row.status), col.int(row.total)]))
}

export interface JobOrderDetail extends JobOrderRow {
  readonly toleranceAppliedPct: string | null
  readonly varianceKg: string | null
  readonly varianceReason: string | null
  readonly varianceApprovedByName: string | null
  readonly supervisorName: string | null
  readonly scheduledStartAt: Date | null
  readonly closedAt: Date | null
  readonly notes: string | null
  readonly appointmentReference: string | null
}

export async function findJobOrder(tx: Tx, id: string): Promise<JobOrderDetail | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select
        j.*,
        cu.legal_name  as customer_name,
        cons.reference as consignment_reference,
        m.name_en      as machine_name,
        sup.full_name  as supervisor_name,
        va.full_name   as variance_approved_by_name,
        ap.reference   as appointment_reference
      from public.job_order j
      join public.customer cu      on cu.id = j.customer_id
      join public.consignment cons on cons.id = j.consignment_id
      left join public.machine m   on m.id = j.machine_id
      left join public.app_user sup on sup.id = j.supervisor_id
      left join public.app_user va  on va.id = j.variance_approved_by
      left join public.appointment ap on ap.id = j.appointment_id
      where j.id = ${id}::uuid
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    ...toJobOrder(row),
    toleranceAppliedPct: col.numericOrNull(row.tolerance_applied_pct),
    varianceKg: col.numericOrNull(row.variance_kg),
    varianceReason: col.textOrNull(row.variance_reason),
    varianceApprovedByName: col.textOrNull(row.variance_approved_by_name),
    supervisorName: col.textOrNull(row.supervisor_name),
    scheduledStartAt: col.dateOrNull(row.scheduled_start_at),
    closedAt: col.dateOrNull(row.closed_at),
    notes: col.textOrNull(row.notes),
    appointmentReference: col.textOrNull(row.appointment_reference),
  }
}

export interface JobInputRow {
  readonly id: string
  readonly lineNo: number
  readonly lotReference: string
  readonly locationCode: string | null
  readonly quantityKg: string
  readonly keshaCount: number | null
  readonly issuedAt: Date | null
}

export async function jobInputs(tx: Tx, jobOrderId: string): Promise<JobInputRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        i.id, i.line_no, i.quantity_kg, i.kesha_count, i.issued_at,
        l.reference as lot_reference,
        s.code      as location_code
      from public.job_order_input i
      join public.lot l on l.id = i.lot_id
      left join public.store_section s on s.id = i.location_id
      where i.job_order_id = ${jobOrderId}::uuid
      order by i.line_no
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    lineNo: col.int(row.line_no),
    lotReference: col.text(row.lot_reference),
    locationCode: col.textOrNull(row.location_code),
    quantityKg: col.numeric(row.quantity_kg),
    keshaCount: col.intOrNull(row.kesha_count),
    issuedAt: col.dateOrNull(row.issued_at),
  }))
}

export interface JobOutputRow {
  readonly id: string
  readonly lineNo: number
  readonly classificationName: string | null
  readonly isLoss: boolean
  readonly quantityKg: string
  readonly keshaCount: number | null
  readonly percentOfInput: string | null
  readonly lotReference: string | null
  readonly locationCode: string | null
  readonly notes: string | null
}

/**
 * Outputs, with loss last.
 *
 * Loss is an output row with a positive quantity, not a negative input — it is a
 * DESTINATION. Sorting it to the bottom keeps the products together and puts the number the
 * supervisor is judged on where they expect it.
 */
export async function jobOutputs(tx: Tx, jobOrderId: string): Promise<JobOutputRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        o.id, o.line_no, o.is_loss, o.quantity_kg, o.kesha_count, o.percent_of_input, o.notes,
        oc.name_en  as classification_name,
        l.reference as lot_reference,
        s.code      as location_code
      from public.job_order_output o
      left join public.output_classification oc on oc.id = o.classification_id
      left join public.lot l on l.id = o.lot_id
      left join public.store_section s on s.id = o.location_id
      where o.job_order_id = ${jobOrderId}::uuid
      order by o.is_loss asc, o.line_no
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    lineNo: col.int(row.line_no),
    classificationName: col.textOrNull(row.classification_name),
    isLoss: col.bool(row.is_loss),
    quantityKg: col.numeric(row.quantity_kg),
    keshaCount: col.intOrNull(row.kesha_count),
    percentOfInput: col.numericOrNull(row.percent_of_input),
    lotReference: col.textOrNull(row.lot_reference),
    locationCode: col.textOrNull(row.location_code),
    notes: col.textOrNull(row.notes),
  }))
}

export interface ProductionLogRow {
  readonly id: string
  readonly loggedOn: string
  readonly shiftCode: string | null
  readonly processedKg: string
  readonly runMinutes: number | null
  readonly downtimeMinutes: number
  readonly downtimeReason: string | null
  readonly operatorNote: string | null
  readonly occurredAt: Date
}

export async function jobProductionLogs(
  tx: Tx,
  jobOrderId: string,
): Promise<ProductionLogRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, logged_on, shift_code, processed_kg, run_minutes,
             downtime_minutes, downtime_reason, operator_note, occurred_at
      from public.job_production_log
      where job_order_id = ${jobOrderId}::uuid
      order by occurred_at desc
      limit 100
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    loggedOn: col.text(row.logged_on),
    shiftCode: col.textOrNull(row.shift_code),
    processedKg: col.numeric(row.processed_kg),
    runMinutes: col.intOrNull(row.run_minutes),
    downtimeMinutes: col.int(row.downtime_minutes),
    downtimeReason: col.textOrNull(row.downtime_reason),
    operatorNote: col.textOrNull(row.operator_note),
    occurredAt: col.date(row.occurred_at),
  }))
}

export interface ProcessingRequestRow {
  readonly id: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly consignmentReference: string | null
  readonly status: string
  readonly serviceType: string
  readonly requestedQuantityKg: string
  readonly requestedKeshaCount: number | null
  readonly urgency: string
  readonly preferredStartOn: string | null
  readonly createdAt: Date
}

export async function listProcessingRequests(
  tx: Tx,
  filters: {
    status?: string | undefined
    customerId?: string | undefined
    limit?: number | undefined
    cursor?: string | undefined
  } = {},
): Promise<ListPage<ProcessingRequestRow>> {
  const limit = listLimit(filters.limit)

  const rows = await rawRows(
    tx,
    sql`
      select
        p.id, p.reference, p.customer_id, p.status, p.service_type,
        p.requested_quantity_kg, p.requested_kesha_count, p.urgency,
        p.preferred_start_on, p.created_at,
        cu.legal_name  as customer_name,
        cons.reference as consignment_reference
      from public.processing_request p
      join public.customer cu on cu.id = p.customer_id
      left join public.consignment cons on cons.id = p.consignment_id
      where 1 = 1
        ${filters.status ? sql`and p.status = ${filters.status}` : sql``}
        ${filters.customerId ? sql`and p.customer_id = ${filters.customerId}::uuid` : sql``}
        ${keysetBefore(sql`p.created_at`, sql`p.id`, filters.cursor)}
      order by p.created_at desc, p.id desc
      limit ${limit + 1}
    `,
  )

  return toListPage(
    rows.map((row): ProcessingRequestRow => ({
      id: col.text(row.id),
      reference: col.text(row.reference),
      customerId: col.text(row.customer_id),
      customerName: col.text(row.customer_name),
      consignmentReference: col.textOrNull(row.consignment_reference),
      status: col.text(row.status),
      serviceType: col.text(row.service_type),
      requestedQuantityKg: col.numeric(row.requested_quantity_kg),
      requestedKeshaCount: col.intOrNull(row.requested_kesha_count),
      urgency: col.text(row.urgency),
      preferredStartOn: col.textOrNull(row.preferred_start_on),
      createdAt: col.date(row.created_at),
    })),
    limit,
    (row) => ({ sortValue: cursorValue(row.createdAt), id: row.id }),
  )
}

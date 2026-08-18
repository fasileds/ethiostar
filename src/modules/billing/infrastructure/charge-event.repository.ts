import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

export interface InsertChargeEventInput {
  readonly customerId: string
  readonly branchId: string
  readonly contractId: string | null
  readonly serviceCode: string
  readonly sourceType: string
  readonly sourceId: string
  readonly quantity: string | null
  readonly keshaQuantity: number | null
  readonly uom: string
  readonly rateAmount: string
  readonly amount: string
  readonly currency: string
  readonly occurredAt: Date
  readonly actorId: string
}

export async function insertChargeEvent(
  tx: Tx,
  input: InsertChargeEventInput,
): Promise<string> {
  const id = uuidv7()
  await tx.execute(sql`
    insert into public.charge_event (
      id, customer_id, branch_id, contract_id, service_code, source_type, source_id,
      quantity, kesha_quantity, uom, rate_amount, amount, currency, occurred_at,
      invoice_line_id, created_at, created_by
    ) values (
      ${id}::uuid, ${input.customerId}::uuid, ${input.branchId}::uuid,
      ${input.contractId}::uuid, ${input.serviceCode}, ${input.sourceType},
      ${input.sourceId}::uuid, ${input.quantity}::numeric, ${input.keshaQuantity},
      ${input.uom}, ${input.rateAmount}::numeric, ${input.amount}::numeric, ${input.currency},
      ${input.occurredAt.toISOString()}::timestamptz, null, now(), ${input.actorId}::uuid
    )
  `)
  return id
}

export interface ChargeEventRow {
  readonly id: string
  readonly customerId: string
  readonly branchId: string
  readonly serviceCode: string
  readonly sourceType: string
  readonly sourceId: string
  readonly quantity: string | null
  readonly keshaQuantity: number | null
  readonly uom: string
  readonly rateAmount: string
  readonly amount: string
  readonly currency: string
  readonly occurredAt: Date
}

function toChargeEventRow(row: Record<string, unknown>): ChargeEventRow {
  return {
    id: col.text(row.id),
    customerId: col.text(row.customer_id),
    branchId: col.text(row.branch_id),
    serviceCode: col.text(row.service_code),
    sourceType: col.text(row.source_type),
    sourceId: col.text(row.source_id),
    quantity: col.numericOrNull(row.quantity),
    keshaQuantity: col.intOrNull(row.kesha_quantity),
    uom: col.text(row.uom),
    rateAmount: col.numeric(row.rate_amount),
    amount: col.numeric(row.amount),
    currency: col.text(row.currency),
    occurredAt: col.date(row.occurred_at),
  }
}

/** Uninvoiced charges for a customer within a period — the sweep `generateInvoice` performs. */
export async function listUninvoicedChargeEvents(
  tx: Tx,
  customerId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<ChargeEventRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, customer_id, branch_id, service_code, source_type, source_id,
             quantity, kesha_quantity, uom, rate_amount, amount, currency, occurred_at
      from public.charge_event
      where customer_id = ${customerId}::uuid
        and invoice_line_id is null
        and occurred_at >= ${periodStart.toISOString()}::timestamptz
        and occurred_at < ${periodEnd.toISOString()}::timestamptz
      order by occurred_at asc
    `,
  )
  return rows.map(toChargeEventRow)
}

export async function markChargeEventInvoiced(
  tx: Tx,
  chargeEventId: string,
  invoiceLineId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.charge_event set invoice_line_id = ${invoiceLineId}::uuid
    where id = ${chargeEventId}::uuid
  `)
}

export interface RecentChargeEventRow extends ChargeEventRow {
  readonly customerName: string
}

/** Most recent charge events across all customers — for the billing dashboard feed. */
export async function recentChargeEvents(
  tx: Tx,
  limit: number,
): Promise<RecentChargeEventRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select ce.id, ce.customer_id, ce.branch_id, ce.service_code, ce.source_type, ce.source_id,
             ce.quantity, ce.kesha_quantity, ce.uom, ce.rate_amount, ce.amount, ce.currency,
             ce.occurred_at, cu.legal_name as customer_name
      from public.charge_event ce
      join public.customer cu on cu.id = ce.customer_id
      order by ce.occurred_at desc
      limit ${limit}
    `,
  )
  return rows.map((row) => ({
    ...toChargeEventRow(row),
    customerName: col.text(row.customer_name),
  }))
}

export interface BranchOption {
  readonly id: string
  readonly name: string
}

export async function listBranchesForBilling(tx: Tx): Promise<BranchOption[]> {
  const rows = await rawRows(
    tx,
    sql`select id, name_en as name from public.branch where is_active order by name_en`,
  )
  return rows.map((row) => ({ id: col.text(row.id), name: col.text(row.name) }))
}

export interface CustomerOption {
  readonly id: string
  readonly name: string
}

export async function listCustomersForBilling(tx: Tx): Promise<CustomerOption[]> {
  const rows = await rawRows(
    tx,
    sql`select id, legal_name as name from public.customer where status <> 'REJECTED' order by legal_name`,
  )
  return rows.map((row) => ({ id: col.text(row.id), name: col.text(row.name) }))
}

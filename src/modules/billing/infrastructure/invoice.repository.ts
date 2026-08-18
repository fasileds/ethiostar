import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import type { ChargeEventRow } from './charge-event.repository'

export interface CreateInvoiceInput {
  readonly reference: string
  readonly customerId: string
  readonly branchId: string
  readonly contractId: string | null
  readonly issueDate: string
  readonly dueDate: string
  readonly subtotalAmount: string
  readonly currency: string
  readonly actorId: string
}

export async function createInvoiceDraft(tx: Tx, input: CreateInvoiceInput): Promise<string> {
  const id = uuidv7()
  await tx.execute(sql`
    insert into public.invoice (
      id, reference, customer_id, branch_id, contract_id, status, issue_date, due_date,
      subtotal_amount, tax_amount, total_amount, paid_amount, currency,
      created_at, created_by, updated_at
    ) values (
      ${id}::uuid, ${input.reference}, ${input.customerId}::uuid, ${input.branchId}::uuid,
      ${input.contractId}::uuid, 'DRAFT', ${input.issueDate}::date, ${input.dueDate}::date,
      ${input.subtotalAmount}::numeric, 0, ${input.subtotalAmount}::numeric, 0, ${input.currency},
      now(), ${input.actorId}::uuid, now()
    )
  `)
  return id
}

export interface InsertInvoiceLineInput {
  readonly invoiceId: string
  readonly chargeEventId: string | null
  readonly lineNo: number
  readonly description: string
  readonly serviceCode: string
  readonly quantity: string | null
  readonly uom: string
  readonly rateAmount: string
  readonly lineAmount: string
  readonly actorId: string
}

export async function insertInvoiceLine(
  tx: Tx,
  input: InsertInvoiceLineInput,
): Promise<string> {
  const id = uuidv7()
  await tx.execute(sql`
    insert into public.invoice_line (
      id, invoice_id, charge_event_id, line_no, description, service_code, quantity, uom,
      rate_amount, line_amount, created_at, created_by, updated_at
    ) values (
      ${id}::uuid, ${input.invoiceId}::uuid, ${input.chargeEventId}::uuid, ${input.lineNo},
      ${input.description}, ${input.serviceCode}, ${input.quantity}::numeric, ${input.uom},
      ${input.rateAmount}::numeric, ${input.lineAmount}::numeric, now(), ${input.actorId}::uuid, now()
    )
  `)
  return id
}

export interface InvoiceRow {
  readonly id: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly branchId: string
  readonly branchName: string
  readonly status: string
  readonly issueDate: string
  readonly dueDate: string
  readonly subtotalAmount: string
  readonly taxAmount: string
  readonly totalAmount: string
  readonly paidAmount: string
  readonly currency: string
  readonly notes: string | null
}

function toInvoiceRow(row: Record<string, unknown>): InvoiceRow {
  return {
    id: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    branchId: col.text(row.branch_id),
    branchName: col.text(row.branch_name),
    status: col.text(row.status),
    issueDate: col.text(row.issue_date),
    dueDate: col.text(row.due_date),
    subtotalAmount: col.numeric(row.subtotal_amount),
    taxAmount: col.numeric(row.tax_amount),
    totalAmount: col.numeric(row.total_amount),
    paidAmount: col.numeric(row.paid_amount),
    currency: col.text(row.currency),
    notes: col.textOrNull(row.notes),
  }
}

const INVOICE_SELECT = sql`
  select i.id, i.reference, i.customer_id, cu.legal_name as customer_name, i.branch_id,
         b.name_en as branch_name, i.status, i.issue_date, i.due_date, i.subtotal_amount,
         i.tax_amount, i.total_amount, i.paid_amount, i.currency, i.notes
  from public.invoice i
  join public.customer cu on cu.id = i.customer_id
  join public.branch b on b.id = i.branch_id
`

export async function listInvoicesAdmin(tx: Tx, status?: string): Promise<InvoiceRow[]> {
  const rows = status
    ? await rawRows(
        tx,
        sql`${INVOICE_SELECT} where i.status = ${status} order by i.issue_date desc`,
      )
    : await rawRows(tx, sql`${INVOICE_SELECT} order by i.issue_date desc`)
  return rows.map(toInvoiceRow)
}

export async function listInvoicesForCustomer(
  tx: Tx,
  customerId: string,
): Promise<InvoiceRow[]> {
  const rows = await rawRows(
    tx,
    sql`${INVOICE_SELECT} where i.customer_id = ${customerId}::uuid order by i.issue_date desc`,
  )
  return rows.map(toInvoiceRow)
}

export async function findInvoice(tx: Tx, invoiceId: string): Promise<InvoiceRow | null> {
  const rows = await rawRows(tx, sql`${INVOICE_SELECT} where i.id = ${invoiceId}::uuid limit 1`)
  return rows[0] ? toInvoiceRow(rows[0]) : null
}

/** Locks the invoice row so status/paid-amount transitions cannot race. */
export async function lockInvoice(tx: Tx, invoiceId: string): Promise<InvoiceRow | null> {
  const rows = await rawRows(
    tx,
    sql`${INVOICE_SELECT} where i.id = ${invoiceId}::uuid limit 1 for update of i`,
  )
  return rows[0] ? toInvoiceRow(rows[0]) : null
}

export interface InvoiceLineRow {
  readonly id: string
  readonly lineNo: number
  readonly description: string
  readonly serviceCode: string
  readonly quantity: string | null
  readonly uom: string
  readonly rateAmount: string
  readonly lineAmount: string
}

export async function listInvoiceLines(tx: Tx, invoiceId: string): Promise<InvoiceLineRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, line_no, description, service_code, quantity, uom, rate_amount, line_amount
      from public.invoice_line
      where invoice_id = ${invoiceId}::uuid
      order by line_no
    `,
  )
  return rows.map((row) => ({
    id: col.text(row.id),
    lineNo: col.int(row.line_no),
    description: col.text(row.description),
    serviceCode: col.text(row.service_code),
    quantity: col.numericOrNull(row.quantity),
    uom: col.text(row.uom),
    rateAmount: col.numeric(row.rate_amount),
    lineAmount: col.numeric(row.line_amount),
  }))
}

export async function setInvoiceStatus(
  tx: Tx,
  invoiceId: string,
  status: string,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.invoice
    set status = ${status}, updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${invoiceId}::uuid
  `)
}

export async function voidInvoiceRow(
  tx: Tx,
  invoiceId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.invoice
    set status = 'VOID', voided_at = now(), voided_reason = ${reason},
        updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${invoiceId}::uuid
  `)
}

export async function addPaidAmount(
  tx: Tx,
  invoiceId: string,
  amount: string,
  newStatus: string,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.invoice
    set paid_amount = paid_amount + ${amount}::numeric, status = ${newStatus},
        updated_at = now(), updated_by = ${actorId}::uuid, version = version + 1
    where id = ${invoiceId}::uuid
  `)
}

/** Outstanding balance for a customer — ISSUED/PARTIALLY_PAID/OVERDUE invoices only. */
export async function outstandingBalanceFor(tx: Tx, customerId: string): Promise<string> {
  const rows = await rawRows(
    tx,
    sql`
      select coalesce(sum(total_amount - paid_amount), 0) as balance
      from public.invoice
      where customer_id = ${customerId}::uuid
        and status in ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
    `,
  )
  return col.numeric(rows[0]?.balance)
}

/** Whether the customer has any invoice past its due date and still owing. */
export async function hasOverdueInvoice(
  tx: Tx,
  customerId: string,
  asOf: Date,
): Promise<boolean> {
  const rows = await rawRows(
    tx,
    sql`
      select 1
      from public.invoice
      where customer_id = ${customerId}::uuid
        and status in ('ISSUED', 'PARTIALLY_PAID')
        and due_date < ${asOf.toISOString()}::date
        and total_amount > paid_amount
      limit 1
    `,
  )
  return rows.length > 0
}

export interface ReceivablesSummary {
  readonly outstandingTotal: string
  readonly overdueCount: number
}

/** Dashboard aggregate — outstanding total across all customers, and how many are overdue. */
export async function receivablesSummary(tx: Tx, asOf: Date): Promise<ReceivablesSummary> {
  const rows = await rawRows(
    tx,
    sql`
      select
        coalesce(sum(total_amount - paid_amount) filter (where status in ('ISSUED','PARTIALLY_PAID','OVERDUE')), 0) as outstanding_total,
        count(*) filter (where status in ('ISSUED','PARTIALLY_PAID') and due_date < ${asOf.toISOString()}::date and total_amount > paid_amount) as overdue_count
      from public.invoice
    `,
  )
  const row = rows[0]
  return {
    outstandingTotal: col.numeric(row?.outstanding_total),
    overdueCount: col.int(row?.overdue_count ?? 0),
  }
}

/** Every charge line so far, un-invoiced, for a preview — used by nothing yet but harmless. */
export function invoiceLineDescriptionFor(charge: ChargeEventRow): string {
  return `${charge.serviceCode} — ${charge.sourceType} ${charge.sourceId.slice(0, 8)}`
}

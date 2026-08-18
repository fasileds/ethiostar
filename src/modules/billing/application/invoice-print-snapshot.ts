import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/**
 * The print-ready snapshot shared by TAX_INVOICE and PROFORMA_INVOICE — same shape, same
 * loader; the entry (`entries/billing-entries.tsx`) picks the title and passes `isProforma`
 * to the template rather than duplicating the query.
 */

export interface InvoiceSnapshotLine {
  readonly lineNo: number
  readonly description: string
  readonly serviceCode: string
  readonly quantity: string | null
  readonly uom: string
  readonly rateAmount: string
  readonly lineAmount: string
}

export interface InvoiceSnapshot {
  readonly invoiceId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
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
  readonly lines: readonly InvoiceSnapshotLine[]
}

export async function loadInvoiceSnapshot(
  tx: Tx,
  invoiceId: string,
): Promise<InvoiceSnapshot | undefined> {
  const headerRows = await rawRows(
    tx,
    sql`
      select i.id, i.reference, i.customer_id, cu.legal_name as customer_name,
             b.name_en as branch_name, i.status, i.issue_date, i.due_date, i.subtotal_amount,
             i.tax_amount, i.total_amount, i.paid_amount, i.currency, i.notes
      from public.invoice i
      join public.customer cu on cu.id = i.customer_id
      join public.branch b on b.id = i.branch_id
      where i.id = ${invoiceId}::uuid
      limit 1
    `,
  )
  const header = headerRows[0]
  if (!header) return undefined

  const lineRows = await rawRows(
    tx,
    sql`
      select line_no, description, service_code, quantity, uom, rate_amount, line_amount
      from public.invoice_line
      where invoice_id = ${invoiceId}::uuid
      order by line_no
    `,
  )

  return {
    invoiceId: col.text(header.id),
    reference: col.text(header.reference),
    customerId: col.text(header.customer_id),
    customerName: col.text(header.customer_name),
    branchName: col.text(header.branch_name),
    status: col.text(header.status),
    issueDate: col.text(header.issue_date),
    dueDate: col.text(header.due_date),
    subtotalAmount: col.numeric(header.subtotal_amount),
    taxAmount: col.numeric(header.tax_amount),
    totalAmount: col.numeric(header.total_amount),
    paidAmount: col.numeric(header.paid_amount),
    currency: col.text(header.currency),
    notes: col.textOrNull(header.notes),
    lines: lineRows.map((row) => ({
      lineNo: col.int(row.line_no),
      description: col.text(row.description),
      serviceCode: col.text(row.service_code),
      quantity: col.numericOrNull(row.quantity),
      uom: col.text(row.uom),
      rateAmount: col.numeric(row.rate_amount),
      lineAmount: col.numeric(row.line_amount),
    })),
  }
}

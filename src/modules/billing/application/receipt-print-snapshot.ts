import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

export interface ReceiptSnapshot {
  readonly paymentId: string
  readonly reference: string
  readonly customerId: string
  readonly customerName: string
  readonly invoiceReference: string | null
  readonly amount: string
  readonly currency: string
  readonly method: string
  readonly externalReference: string | null
  readonly receivedAt: Date
  readonly recordedByName: string | null
}

export async function loadReceiptSnapshot(
  tx: Tx,
  paymentId: string,
): Promise<ReceiptSnapshot | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select p.id, p.reference, p.customer_id, cu.legal_name as customer_name,
             inv.reference as invoice_reference, p.amount, p.currency, p.method,
             p.external_reference, p.received_at, u.full_name as recorded_by_name
      from public.payment p
      join public.customer cu on cu.id = p.customer_id
      left join public.invoice inv on inv.id = p.invoice_id
      left join public.app_user u on u.id = p.recorded_by
      where p.id = ${paymentId}::uuid
      limit 1
    `,
  )
  const row = rows[0]
  if (!row) return undefined

  return {
    paymentId: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    customerName: col.text(row.customer_name),
    invoiceReference: col.textOrNull(row.invoice_reference),
    amount: col.numeric(row.amount),
    currency: col.text(row.currency),
    method: col.text(row.method),
    externalReference: col.textOrNull(row.external_reference),
    receivedAt: col.date(row.received_at),
    recordedByName: col.textOrNull(row.recorded_by_name),
  }
}

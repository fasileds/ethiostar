import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

export interface InsertPaymentInput {
  readonly reference: string
  readonly customerId: string
  readonly invoiceId: string | null
  readonly amount: string
  readonly currency: string
  readonly method: string
  readonly externalReference: string | null
  readonly receivedAt: Date
  readonly recordedBy: string
}

export async function insertPayment(tx: Tx, input: InsertPaymentInput): Promise<string> {
  const id = uuidv7()
  await tx.execute(sql`
    insert into public.payment (
      id, reference, customer_id, invoice_id, amount, currency, method, external_reference,
      received_at, recorded_by, created_at, created_by, updated_at
    ) values (
      ${id}::uuid, ${input.reference}, ${input.customerId}::uuid, ${input.invoiceId}::uuid,
      ${input.amount}::numeric, ${input.currency}, ${input.method}, ${input.externalReference},
      ${input.receivedAt.toISOString()}::timestamptz, ${input.recordedBy}::uuid,
      now(), ${input.recordedBy}::uuid, now()
    )
  `)
  return id
}

export interface PaymentRow {
  readonly id: string
  readonly reference: string
  readonly customerId: string
  readonly invoiceId: string | null
  readonly amount: string
  readonly currency: string
  readonly method: string
  readonly externalReference: string | null
  readonly receivedAt: Date
  readonly recordedByName: string | null
}

function toPaymentRow(row: Record<string, unknown>): PaymentRow {
  return {
    id: col.text(row.id),
    reference: col.text(row.reference),
    customerId: col.text(row.customer_id),
    invoiceId: col.textOrNull(row.invoice_id),
    amount: col.numeric(row.amount),
    currency: col.text(row.currency),
    method: col.text(row.method),
    externalReference: col.textOrNull(row.external_reference),
    receivedAt: col.date(row.received_at),
    recordedByName: col.textOrNull(row.recorded_by_name),
  }
}

const PAYMENT_SELECT = sql`
  select p.id, p.reference, p.customer_id, p.invoice_id, p.amount, p.currency, p.method,
         p.external_reference, p.received_at, u.full_name as recorded_by_name
  from public.payment p
  left join public.app_user u on u.id = p.recorded_by
`

export async function listPaymentsForInvoice(tx: Tx, invoiceId: string): Promise<PaymentRow[]> {
  const rows = await rawRows(
    tx,
    sql`${PAYMENT_SELECT} where p.invoice_id = ${invoiceId}::uuid order by p.received_at`,
  )
  return rows.map(toPaymentRow)
}

export async function listPaymentsForCustomer(
  tx: Tx,
  customerId: string,
  periodStart?: Date,
  periodEnd?: Date,
): Promise<PaymentRow[]> {
  const rows =
    periodStart && periodEnd
      ? await rawRows(
          tx,
          sql`${PAYMENT_SELECT}
            where p.customer_id = ${customerId}::uuid
              and p.received_at >= ${periodStart.toISOString()}::timestamptz
              and p.received_at < ${periodEnd.toISOString()}::timestamptz
            order by p.received_at`,
        )
      : await rawRows(
          tx,
          sql`${PAYMENT_SELECT} where p.customer_id = ${customerId}::uuid order by p.received_at desc`,
        )
  return rows.map(toPaymentRow)
}

export async function findPayment(tx: Tx, paymentId: string): Promise<PaymentRow | null> {
  const rows = await rawRows(tx, sql`${PAYMENT_SELECT} where p.id = ${paymentId}::uuid limit 1`)
  return rows[0] ? toPaymentRow(rows[0]) : null
}

import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

export interface StatementInvoiceLine {
  readonly reference: string
  readonly issueDate: string
  readonly dueDate: string
  readonly status: string
  readonly totalAmount: string
  readonly paidAmount: string
}

export interface StatementPaymentLine {
  readonly reference: string
  readonly receivedAt: Date
  readonly amount: string
  readonly method: string
}

export interface AccountStatementSnapshot {
  readonly customerId: string
  readonly customerName: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly currency: string
  readonly openingBalance: string
  readonly closingBalance: string
  readonly invoices: readonly StatementInvoiceLine[]
  readonly payments: readonly StatementPaymentLine[]
}

/**
 * A customer's invoice + payment history over a period, with a running balance. The
 * registry entry (ACCOUNT_STATEMENT / `STM`) has no natural single source record — `sourceId`
 * there is the customer id, and the period defaults to the trailing 90 days ending today.
 */
export async function loadAccountStatementSnapshot(
  tx: Tx,
  customerId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<AccountStatementSnapshot | undefined> {
  const customerRows = await rawRows(
    tx,
    sql`select legal_name from public.customer where id = ${customerId}::uuid limit 1`,
  )
  const customer = customerRows[0]
  if (!customer) return undefined

  const openingRows = await rawRows(
    tx,
    sql`
      select coalesce(sum(total_amount), 0) as invoiced, coalesce((
        select sum(amount) from public.payment
        where customer_id = ${customerId}::uuid and received_at < ${periodStart.toISOString()}::timestamptz
      ), 0) as paid
      from public.invoice
      where customer_id = ${customerId}::uuid
        and status <> 'VOID'
        and issue_date < ${periodStart.toISOString()}::date
    `,
  )
  const openingBalance = (
    Number(col.numeric(openingRows[0]?.invoiced)) - Number(col.numeric(openingRows[0]?.paid))
  ).toFixed(2)

  const invoiceRows = await rawRows(
    tx,
    sql`
      select reference, issue_date, due_date, status, total_amount, paid_amount, currency
      from public.invoice
      where customer_id = ${customerId}::uuid
        and status <> 'VOID'
        and issue_date >= ${periodStart.toISOString()}::date
        and issue_date < ${periodEnd.toISOString()}::date
      order by issue_date
    `,
  )

  const paymentRows = await rawRows(
    tx,
    sql`
      select reference, received_at, amount, method
      from public.payment
      where customer_id = ${customerId}::uuid
        and received_at >= ${periodStart.toISOString()}::timestamptz
        and received_at < ${periodEnd.toISOString()}::timestamptz
      order by received_at
    `,
  )

  const invoiced = invoiceRows.reduce((sum, r) => sum + Number(col.numeric(r.total_amount)), 0)
  const paid = paymentRows.reduce((sum, r) => sum + Number(col.numeric(r.amount)), 0)
  const closingBalance = (Number(openingBalance) + invoiced - paid).toFixed(2)

  return {
    customerId,
    customerName: col.text(customer.legal_name),
    periodStart,
    periodEnd,
    currency: 'ETB',
    openingBalance,
    closingBalance,
    invoices: invoiceRows.map((row) => ({
      reference: col.text(row.reference),
      issueDate: col.text(row.issue_date),
      dueDate: col.text(row.due_date),
      status: col.text(row.status),
      totalAmount: col.numeric(row.total_amount),
      paidAmount: col.numeric(row.paid_amount),
    })),
    payments: paymentRows.map((row) => ({
      reference: col.text(row.reference),
      receivedAt: col.date(row.received_at),
      amount: col.numeric(row.amount),
      method: col.text(row.method),
    })),
  }
}

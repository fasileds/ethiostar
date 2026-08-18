import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pageContext, pageQuery } from '@server/page-data'
import {
  findInvoice,
  listInvoiceLines,
  listPaymentsForInvoice,
  type InvoiceRow,
  type InvoiceLineRow,
  type PaymentRow,
} from '@modules/billing'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { StatusChip } from '@ui/patterns/StatusChip'
import { OnDate } from '@ui/patterns/DateTime'
import { InvoiceDetailClient } from './InvoiceDetailClient'

export const metadata: Metadata = { title: 'Invoice' }

export default async function InvoiceDetailPage(props: PageProps<'/billing/invoices/[id]'>) {
  const { id } = await props.params
  const { readiness } = await pageContext()

  const invoice = await pageQuery(null as InvoiceRow | null, (tx) => findInvoice(tx, id))
  if (readiness.ready && !invoice) notFound()

  const [lines, payments] = await Promise.all([
    pageQuery([] as InvoiceLineRow[], (tx) => listInvoiceLines(tx, id)),
    pageQuery([] as PaymentRow[], (tx) => listPaymentsForInvoice(tx, id)),
  ])

  if (!invoice) {
    return (
      <div className="space-y-6">
        <PageHeader title="Invoice" />
        <SetupNotice readiness={readiness} />
      </div>
    )
  }

  const balance = (Number(invoice.totalAmount) - Number(invoice.paidAmount)).toFixed(2)

  return (
    <div className="space-y-6">
      <PageHeader
        title={invoice.reference}
        description={`${invoice.customerName} · ${invoice.branchName}`}
        meta={<StatusChip status={invoice.status} />}
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-sm text-[var(--text-tertiary)]">Issued</p>
          <p className="mt-1">
            <OnDate value={invoice.issueDate} />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-tertiary)]">Due</p>
          <p className="mt-1">
            <OnDate value={invoice.dueDate} />
          </p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-tertiary)]">Total</p>
          <p className="numeric mt-1 font-semibold">
            {invoice.totalAmount} {invoice.currency}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-tertiary)]">Balance due</p>
          <p className="numeric mt-1 font-semibold">
            {balance} {invoice.currency}
          </p>
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader title="Lines" />
        </div>
        <ul className="divide-y divide-[var(--border-subtle)]">
          {lines.map((line) => (
            <li key={line.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <span className="numeric shrink-0 text-xs text-[var(--text-tertiary)]">
                #{line.lineNo}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{line.description}</span>
              <span className="numeric shrink-0 text-sm font-medium">{line.lineAmount}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader title="Payments" />
        </div>
        {payments.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
            No payments recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
              >
                <span className="shrink-0 font-medium">{payment.reference}</span>
                <span className="shrink-0 text-xs text-[var(--text-tertiary)]">
                  {payment.method}
                </span>
                <span className="numeric shrink-0 ml-auto text-sm font-semibold">
                  {payment.amount} {payment.currency}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <InvoiceDetailClient invoice={invoice} />
    </div>
  )
}

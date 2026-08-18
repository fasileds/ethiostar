import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import {
  listInvoicesForCustomer,
  listPaymentsForCustomer,
  outstandingBalanceFor,
  type InvoiceRow,
  type PaymentRow,
} from '@modules/billing'
import { PageHeader, Card, CardHeader, EmptyState } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { StatusChip } from '@ui/patterns/StatusChip'
import { OnDate, When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Billing' }

/**
 * The customer's own invoices, balance and payment history. RLS-scoped via `customer_id` on
 * the claims, same as every other portal query — the application also passes `customerId`
 * explicitly, exactly as `portal/dashboard/page.tsx` does.
 */
export default async function PortalBillingPage() {
  const { readiness, customerId } = await pageContext()

  const [invoices, payments, balance] = await Promise.all([
    pageQuery([] as InvoiceRow[], (tx) =>
      customerId ? listInvoicesForCustomer(tx, customerId) : Promise.resolve([]),
    ),
    pageQuery([] as PaymentRow[], (tx) =>
      customerId ? listPaymentsForCustomer(tx, customerId) : Promise.resolve([]),
    ),
    pageQuery('0.00', (tx) =>
      customerId ? outstandingBalanceFor(tx, customerId) : Promise.resolve('0.00'),
    ),
  ])

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description="Your invoices, balance and payment history." />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card>
        <p className="text-sm text-[var(--text-tertiary)]">Outstanding balance</p>
        <p className="numeric mt-1 text-2xl font-semibold">{balance} ETB</p>
      </Card>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader title="Invoices" />
        </div>
        {invoices.length === 0 ? (
          <div className="px-4 pb-5 sm:px-5">
            <EmptyState
              title="No invoices yet"
              description="Invoices appear here once EthioStar issues one against your account."
              icon={<Icon name="documents" className="size-8" />}
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {invoices.map((invoice) => (
              <li
                key={invoice.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
              >
                <span className="numeric shrink-0 font-medium">{invoice.reference}</span>
                <OnDate
                  value={invoice.issueDate}
                  className="shrink-0 text-xs text-[var(--text-tertiary)]"
                />
                <span className="min-w-0 flex-1" />
                <span className="numeric shrink-0 text-sm font-semibold">
                  {invoice.totalAmount} {invoice.currency}
                </span>
                <StatusChip status={invoice.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader title="Payment history" />
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
                <span className="min-w-0 flex-1" />
                <span className="numeric shrink-0 text-sm font-semibold">
                  {payment.amount} {payment.currency}
                </span>
                <When
                  value={payment.receivedAt}
                  className="shrink-0 text-xs text-[var(--text-tertiary)]"
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

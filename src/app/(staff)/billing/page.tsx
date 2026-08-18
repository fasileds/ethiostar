import type { Metadata } from 'next'
import Link from 'next/link'
import { systemClock } from '@core/clock/clock'
import { pageContext, pageQuery } from '@server/page-data'
import {
  receivablesSummary,
  recentChargeEvents,
  listOpenHolds,
  type ReceivablesSummary,
  type RecentChargeEventRow,
  type CreditHoldRow,
} from '@modules/billing'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { ButtonLink } from '@ui/primitives/Button'
import { When } from '@ui/patterns/DateTime'

export const metadata: Metadata = { title: 'Billing' }

const EMPTY_SUMMARY: ReceivablesSummary = { outstandingTotal: '0.00', overdueCount: 0 }

/** M19/M20 — the billing dashboard: outstanding receivables, overdue invoices, open holds. */
export default async function BillingPage() {
  const { readiness } = await pageContext()
  const now = systemClock.now()

  const [summary, charges, holds] = await Promise.all([
    pageQuery(EMPTY_SUMMARY, (tx) => receivablesSummary(tx, now)),
    pageQuery([] as RecentChargeEventRow[], (tx) => recentChargeEvents(tx, 15)),
    pageQuery([] as CreditHoldRow[], listOpenHolds),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description="Receivables, invoices, payments and storage charging."
        meta={
          <div className="flex gap-2">
            <ButtonLink href="/billing/charges/new" variant="secondary">
              Raise a charge
            </ButtonLink>
            <ButtonLink href="/billing/invoices">Invoices</ButtonLink>
          </div>
        }
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-[var(--text-tertiary)]">Outstanding receivables</p>
          <p className="numeric mt-1 text-2xl font-semibold">{summary.outstandingTotal} ETB</p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-tertiary)]">Overdue invoices</p>
          <p className="numeric mt-1 text-2xl font-semibold">{summary.overdueCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-[var(--text-tertiary)]">Open credit holds</p>
          <p className="numeric mt-1 text-2xl font-semibold">{holds.length}</p>
          <Link
            href="/billing/holds"
            className="mt-1 inline-block text-sm text-[var(--text-brand)] hover:underline"
          >
            View holds
          </Link>
        </Card>
      </div>

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Recent charge events"
            description="The append-only ledger every invoice line traces back to."
          />
        </div>
        {charges.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
            No charges raised yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {charges.map((charge) => (
              <li
                key={charge.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
              >
                <span className="shrink-0 font-medium">{charge.serviceCode}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">
                  {charge.customerName}
                </span>
                <span className="numeric shrink-0 text-sm font-semibold">
                  {charge.amount} {charge.currency}
                </span>
                <When
                  value={charge.occurredAt}
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

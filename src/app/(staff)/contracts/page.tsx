import type { Metadata } from 'next'
import Link from 'next/link'
import { pageContext, pageQuery } from '@server/page-data'
import { listContractsAdmin, type ContractRow } from '@modules/contracts'
import { PageHeader, Card, CardHeader, EmptyState } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { StatusChip } from '@ui/patterns/StatusChip'
import { OnDate } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'
import { buttonClass } from '@ui/primitives/Button'

export const metadata: Metadata = { title: 'Contracts' }

/**
 * M10 — every commercial agreement, whichever customer or branch. The pricing that M19
 * bills against lives behind each row's negotiated tariff lines, not in a spreadsheet.
 */
export default async function ContractsPage() {
  const { readiness } = await pageContext()
  const contracts = await pageQuery([] as ContractRow[], (tx) => listContractsAdmin(tx))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contracts"
        description="Commercial terms agreed with each customer — free storage days, payment terms, credit limit, and the negotiated rates M19 bills against."
        actions={
          <Link href="/contracts/new" className={buttonClass({ variant: 'primary' })}>
            New contract
          </Link>
        }
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader title="All contracts" />
        </div>

        {contracts.length === 0 ? (
          <div className="px-4 pb-5 sm:px-5">
            <EmptyState
              title="No contracts yet"
              description="A new contract starts as a draft, then is activated once its tariff lines and payment terms are set."
              icon={<Icon name="documents" className="size-8" />}
            />
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {contracts.map((contract) => (
              <li key={contract.id}>
                <Link
                  href={`/contracts/${contract.id}`}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-[var(--surface-hover)] sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{contract.customerName}</p>
                    <p className="numeric truncate text-xs text-[var(--text-tertiary)]">
                      {contract.reference} · {contract.branchName}
                    </p>
                  </div>
                  <OnDate
                    value={contract.effectiveFrom}
                    className="shrink-0 text-xs text-[var(--text-tertiary)]"
                  />
                  <StatusChip status={contract.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

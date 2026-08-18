import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { listContractsForCustomer, type ContractRow } from '@modules/contracts'
import { PageHeader, Card, CardHeader, EmptyState } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { StatusChip } from '@ui/patterns/StatusChip'
import { OnDate } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'My contract' }

/**
 * The customer's own commercial terms. Read-only — a customer can see what was agreed, not
 * change it. Credit limit is shown because it is information about their OWN account
 * (RLS `p_contract__customer` already scopes every query here to `fn_owns_customer`).
 */
export default async function PortalContractPage() {
  const { readiness, customerId } = await pageContext()

  const contracts = customerId
    ? await pageQuery([] as ContractRow[], (tx) => listContractsForCustomer(tx, customerId))
    : []

  const active = contracts.find((c) => c.status === 'ACTIVE')
  const others = contracts.filter((c) => c.id !== active?.id)

  return (
    <div className="space-y-6">
      <PageHeader
        title="My contract"
        description="The commercial terms agreed with EthioStar — free storage, payment terms and the credit limit on your account."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      {!active ? (
        <Card>
          <EmptyState
            title="No active contract"
            description="Your account is currently priced against the branch standard tariff. Contact EthioStar if you expect a negotiated agreement."
            icon={<Icon name="documents" className="size-8" />}
          />
        </Card>
      ) : (
        <Card>
          <CardHeader title={`Contract ${active.reference}`} description={active.branchName} />
          <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-[var(--text-tertiary)]">Effective from</dt>
              <dd>
                <OnDate value={active.effectiveFrom} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-tertiary)]">Effective to</dt>
              <dd>
                <OnDate value={active.effectiveTo} />
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-tertiary)]">Free storage days</dt>
              <dd className="numeric">{active.freeStorageDays}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-tertiary)]">Payment terms</dt>
              <dd className="numeric">{active.paymentTermsDays} days</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--text-tertiary)]">Credit limit</dt>
              <dd className="numeric">
                {active.creditLimitAmount
                  ? `${active.creditLimitAmount} ${active.currency}`
                  : '—'}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      {others.length > 0 ? (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader title="Previous contracts" />
          </div>
          <ul className="divide-y divide-[var(--border-subtle)]">
            {others.map((contract) => (
              <li
                key={contract.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{contract.reference}</p>
                  <p className="text-xs text-[var(--text-tertiary)]">{contract.branchName}</p>
                </div>
                <OnDate
                  value={contract.effectiveFrom}
                  className="shrink-0 text-xs text-[var(--text-tertiary)]"
                />
                <StatusChip status={contract.status} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}

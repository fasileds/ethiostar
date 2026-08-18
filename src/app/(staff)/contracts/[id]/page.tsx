import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pageContext, pageQuery } from '@server/page-data'
import {
  findContract,
  listContractTariff,
  SERVICE_CODE_LIST,
  type ContractRow,
  type TariffLineRow,
} from '@modules/contracts'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { StatusChip } from '@ui/patterns/StatusChip'
import { OnDate } from '@ui/patterns/DateTime'
import { Alert } from '@ui/primitives/Alert'
import { ContractDetailClient } from './ContractDetailClient'

export const metadata: Metadata = { title: 'Contract' }

export default async function ContractDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { readiness } = await pageContext()

  if (!readiness.ready) {
    return (
      <div className="space-y-6">
        <PageHeader title="Contract" />
        <Card>Database is not ready.</Card>
      </div>
    )
  }

  const contract = await pageQuery(undefined, (tx) => findContract(tx, id))
  if (!contract) notFound()

  const tariffLines = await pageQuery([] as TariffLineRow[], (tx) => listContractTariff(tx, id))

  return (
    <div className="space-y-6">
      <PageHeader
        title={contract.customerName}
        description={`Contract ${contract.reference} — ${contract.branchName}`}
        meta={<StatusChip status={contract.status} />}
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <ContractSummary contract={contract} />

      <ContractDetailClient
        contract={contract}
        tariffLines={tariffLines}
        serviceCodes={SERVICE_CODE_LIST}
      />
    </div>
  )
}

function ContractSummary({ contract }: { readonly contract: ContractRow }) {
  return (
    <Card>
      <CardHeader title="Terms" />
      <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-[var(--text-tertiary)]">Effective from</dt>
          <dd>
            <OnDate value={contract.effectiveFrom} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--text-tertiary)]">Effective to</dt>
          <dd>
            <OnDate value={contract.effectiveTo} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--text-tertiary)]">Free storage days</dt>
          <dd className="numeric">{contract.freeStorageDays}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--text-tertiary)]">Payment terms</dt>
          <dd className="numeric">{contract.paymentTermsDays} days</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--text-tertiary)]">Credit limit</dt>
          <dd className="numeric">
            {contract.creditLimitAmount
              ? `${contract.creditLimitAmount} ${contract.currency}`
              : '—'}
          </dd>
        </div>
      </dl>
      {contract.notes ? (
        <p className="mt-3 text-sm text-[var(--text-secondary)]">{contract.notes}</p>
      ) : null}
      {contract.status === 'TERMINATED' && contract.terminatedReason ? (
        <div className="mt-3">
          <Alert tone="danger">Terminated: {contract.terminatedReason}</Alert>
        </div>
      ) : null}
    </Card>
  )
}

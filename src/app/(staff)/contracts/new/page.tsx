import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { listCustomers, type CustomerRow } from '@modules/customers'
import { listBranches, type BranchOption } from '@modules/warehouse'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { ContractForm } from './ContractForm'

export const metadata: Metadata = { title: 'New contract' }

export default async function NewContractPage() {
  const { readiness } = await pageContext()

  const [customers, branches] = await Promise.all([
    pageQuery({ items: [], hasMore: false, nextCursor: null }, (tx) =>
      listCustomers(tx, { limit: 200 }),
    ),
    pageQuery([] as BranchOption[], (tx) => listBranches(tx)),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="New contract"
        description="Draft the commercial terms with a customer — free storage days, payment terms and credit limit. Tariff lines are added once the contract is created."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card className="max-w-2xl">
        <ContractForm customers={customers.items as CustomerRow[]} branches={branches} />
      </Card>
    </div>
  )
}

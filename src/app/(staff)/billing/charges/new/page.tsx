import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { listBranchesForBilling, listCustomersForBilling } from '@modules/billing'
import { SERVICE_CODE_LIST } from '@modules/contracts'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { ChargeForm } from './ChargeForm'

export const metadata: Metadata = { title: 'Raise a charge' }

/**
 * M19 — manual charge capture against a source record. Automatic charge capture from every
 * M11/M15/M17 use case is out of scope for this pass (see `raise-charge.ts`); this page is
 * what makes the billing pipeline usable end-to-end in the meantime.
 */
export default async function RaiseChargePage() {
  const { readiness } = await pageContext()

  const [customers, branches] = await Promise.all([
    pageQuery(
      [] as Awaited<ReturnType<typeof listCustomersForBilling>>,
      listCustomersForBilling,
    ),
    pageQuery([] as Awaited<ReturnType<typeof listBranchesForBilling>>, listBranchesForBilling),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Raise a charge"
        description="Price a billable event against its source record — the tariff line active for the customer and branch today applies."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="New charge"
            description="The source reference is the id of the goods receipt, job order or other record this charge is for."
          />
        </div>
        <div className="px-4 pb-5 sm:px-5">
          <ChargeForm
            customers={customers}
            branches={branches}
            serviceCodes={[...SERVICE_CODE_LIST]}
          />
        </div>
      </Card>
    </div>
  )
}

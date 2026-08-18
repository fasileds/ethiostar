import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { deliveryRequestFormOptions } from '@modules/inbound'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { NewRequestForm } from './NewRequestForm'

export const metadata: Metadata = { title: 'New delivery request' }

export default async function NewDeliveryRequestPage() {
  const { readiness } = await pageContext()

  const options = await pageQuery(
    { coffeeTypes: [], coffeeGrades: [], harvestYears: [], bagTypes: [] },
    (tx) => deliveryRequestFormOptions(tx),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="New delivery request"
        description="Tell us what you're bringing and when. We'll confirm space and let you know if the date needs to move."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card className="max-w-2xl">
        <NewRequestForm
          coffeeTypes={options.coffeeTypes}
          harvestYears={options.harvestYears}
          disabled={!readiness.ready}
        />
      </Card>
    </div>
  )
}

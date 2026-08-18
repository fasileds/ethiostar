import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pageContext, pageQuery } from '@server/page-data'
import {
  findDeliveryRequest,
  sectionsWithRoom,
  deliveryRequestFormOptions,
  type AvailableSection,
} from '@modules/inbound'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { Quantity } from '@ui/patterns/Quantity'
import { ReceiveForm } from './ReceiveForm'

export const metadata: Metadata = { title: 'Receive coffee' }

export default async function ReceiveGoodsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ request?: string }>
}) {
  const { request: deliveryRequestId } = await searchParams
  const { readiness } = await pageContext()

  if (!deliveryRequestId) notFound()

  if (!readiness.ready) {
    return (
      <div className="space-y-6">
        <PageHeader title="Receive coffee" />
        <Card>Database is not ready.</Card>
      </div>
    )
  }

  const detail = await pageQuery(undefined, (tx) => findDeliveryRequest(tx, deliveryRequestId))
  if (!detail) notFound()

  const [sections, options] = await Promise.all([
    pageQuery([] as AvailableSection[], (tx) =>
      sectionsWithRoom(tx, detail.declaredQuantityKg, detail.declaredKeshaCount),
    ),
    pageQuery({ coffeeTypes: [], coffeeGrades: [], harvestYears: [], bagTypes: [] }, (tx) =>
      deliveryRequestFormOptions(tx),
    ),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Receive from ${detail.customerName}`}
        description={`Delivery request ${detail.reference} — weigh, count, and place into store.`}
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card>
        <CardHeader
          title="Declared"
          description="What the customer told us to expect. Confirm the actual count below — the confirmed count is what the system and the labour payment are built from."
        />
        <div className="mt-3">
          <Quantity
            quantityKg={detail.declaredQuantityKg}
            keshaCount={detail.declaredKeshaCount}
            size="lg"
          />
        </div>
      </Card>

      <Card className="max-w-2xl">
        <ReceiveForm
          deliveryRequestId={detail.id}
          sections={sections}
          bagTypes={options.bagTypes}
          coffeeTypes={options.coffeeTypes}
          coffeeGrades={options.coffeeGrades}
          declaredQuantityKg={detail.declaredQuantityKg}
          declaredKeshaCount={detail.declaredKeshaCount}
        />
      </Card>
    </div>
  )
}

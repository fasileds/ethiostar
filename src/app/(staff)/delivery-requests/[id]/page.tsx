import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { pageContext, pageQuery } from '@server/page-data'
import { findDeliveryRequest, sectionsWithRoom, type AvailableSection } from '@modules/inbound'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Quantity } from '@ui/patterns/Quantity'
import { OnDate, When } from '@ui/patterns/DateTime'
import { ApproveForm, RejectForm } from './DecisionActions'

export const metadata: Metadata = { title: 'Delivery request' }

function Field({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
  if (!value) return null
  return (
    <div>
      <div className="text-xs text-[var(--text-tertiary)]">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  )
}

export default async function DeliveryRequestDetailPage({
  params,
}: {
  readonly params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { readiness } = await pageContext()

  if (!readiness.ready) {
    return (
      <div className="space-y-6">
        <PageHeader title="Delivery request" />
        <Card>Database is not ready.</Card>
      </div>
    )
  }

  const detail = await pageQuery(undefined, (tx) => findDeliveryRequest(tx, id))
  if (!detail) notFound()

  const sections = await pageQuery([] as AvailableSection[], (tx) =>
    sectionsWithRoom(tx, detail.declaredQuantityKg, detail.declaredKeshaCount),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail.customerName}
        description={`Delivery request ${detail.reference}`}
        meta={<StatusChip status={detail.status} />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Request" />
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Field label="Coffee type" value={detail.coffeeTypeName} />
              <Field label="Grade" value={detail.coffeeGradeName} />
              <Field label="Origin" value={detail.originWoredaName} />
              <Field label="Harvest year" value={detail.harvestYearName} />
              <Field label="Bag type" value={detail.bagTypeName} />
              <Field
                label="Declared quantity"
                value={
                  <Quantity
                    quantityKg={detail.declaredQuantityKg}
                    keshaCount={detail.declaredKeshaCount}
                    size="sm"
                  />
                }
              />
              <Field
                label="Expected arrival"
                value={<OnDate value={detail.expectedArrivalOn} />}
              />
              <Field label="Window" value={detail.expectedArrivalWindow} />
              <Field label="Transport" value={detail.transportMode} />
              <Field label="Vehicle" value={detail.vehiclePlate} />
              <Field label="Driver" value={detail.driverName} />
              <Field label="Driver phone" value={detail.driverPhone} />
              <Field label="Branch" value={detail.branchName} />
            </div>
            {detail.notes ? (
              <p className="mt-4 text-sm text-[var(--text-secondary)]">{detail.notes}</p>
            ) : null}
          </Card>

          {detail.status === 'APPROVED' || detail.status === 'RECEIVED' ? (
            <Card>
              <CardHeader title="Reservation" />
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Location" value={detail.reservedLocationCode} />
                <Field label="Consignment" value={detail.consignmentReference} />
                <Field
                  label="Approved"
                  value={detail.approvedAt ? <When value={detail.approvedAt} dateOnly /> : null}
                />
                <Field label="Approved by" value={detail.approvedByName} />
              </div>
            </Card>
          ) : null}

          {detail.status === 'REJECTED' ? (
            <Card>
              <CardHeader title="Rejection" />
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {detail.rejectionReason}
              </p>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          {detail.status === 'SUBMITTED' ? (
            <Card>
              <CardHeader title="Decision" />
              <div className="mt-4 space-y-4">
                <ApproveForm deliveryRequestId={id} sections={sections} />
                <RejectForm deliveryRequestId={id} />
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}

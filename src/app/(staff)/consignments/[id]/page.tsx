import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { pageContext, pageQuery } from '@server/page-data'
import { findConsignment, consignmentLots, type LotRow } from '@modules/consignment'
import { ConsignmentStatusBadge, LotStatusBadge } from '@modules/consignment/ui/StatusBadge'
import type { ConsignmentStatus, LotStatus } from '@modules/consignment'
import { coffeePassport, type PassportEntry } from '@modules/audit'
import { PageHeader, Card, CardHeader, Field, FieldGrid } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { Quantity } from '@ui/patterns/Quantity'
import { When, OnDate } from '@ui/patterns/DateTime'
import { statusLabel } from '@ui/patterns/StatusChip'
import { ButtonLink } from '@ui/primitives/Button'

export const metadata: Metadata = { title: 'Consignment' }

/**
 * The consignment detail — and the coffee passport.
 *
 * The passport is the artefact the client asked for: "the complete life of a consignment on
 * one timeline". It is read from @modules/audit, which derives it from `domain_event` and
 * `stock_movement` rather than from the operational tables, so it cannot disagree with the
 * record it describes. That property is the whole reason it is worth quoting in a dispute.
 */
export default async function ConsignmentDetailPage(props: PageProps<'/consignments/[id]'>) {
  const { id } = await props.params
  const { readiness } = await pageContext()

  const consignment = await pageQuery(null, (tx) =>
    findConsignment(tx, id).then((c) => c ?? null),
  )

  // With no database there is nothing to show, but the shell should still render rather than
  // 404 — a fresh clone is not a missing consignment.
  if (!consignment && readiness.ready) notFound()

  const [lots, passport] = await Promise.all([
    pageQuery([] as LotRow[], (tx) => consignmentLots(tx, id)),
    pageQuery([] as PassportEntry[], (tx) => coffeePassport(tx, id)),
  ])

  if (!consignment) {
    return (
      <div className="space-y-6">
        <PageHeader title="Consignment" />
        <SetupNotice readiness={readiness} />
      </div>
    )
  }

  const shrinkage =
    consignment.receivedQuantityKg && Number(consignment.receivedQuantityKg) > 0
      ? Number(consignment.receivedQuantityKg) - Number(consignment.onHandKg)
      : 0

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link
            href="/consignments"
            className="rounded text-sm text-[var(--text-secondary)] hover:underline"
          >
            ← Consignments
          </Link>
        }
        title={<span className="numeric">{consignment.reference}</span>}
        description={consignment.customerName}
        meta={
          <ConsignmentStatusBadge status={consignment.status as ConsignmentStatus} size="lg" />
        }
        actions={
          <ButtonLink
            href={`/printing?source=consignment&id=${consignment.id}`}
            variant="secondary"
          >
            Print passport
          </ButtonLink>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* ── Quantities ───────────────────────────────────────────────── */}
          <Card>
            <CardHeader
              title="Quantities"
              description="Declared on the request, confirmed at the gate, and what remains in custody now."
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <QuantityBlock
                label="Declared"
                quantityKg={consignment.declaredQuantityKg}
                keshaCount={consignment.declaredKeshaCount}
                hint="By the customer"
              />
              <QuantityBlock
                label="Received"
                quantityKg={consignment.receivedQuantityKg}
                keshaCount={consignment.receivedKeshaCount}
                hint="At the weighbridge"
              />
              <QuantityBlock
                label="On hand"
                quantityKg={consignment.onHandKg}
                keshaCount={consignment.onHandKesha}
                hint="In custody now"
                emphasis
              />
            </div>

            {shrinkage > 0 ? (
              <p className="mt-4 rounded-md bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                <span className="numeric font-semibold">{shrinkage.toFixed(3)} kg</span> has
                left custody through processing loss or dispatch. The passport below shows every
                movement.
              </p>
            ) : null}
          </Card>

          {/* ── Lots ─────────────────────────────────────────────────────── */}
          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardHeader
                title="Lots"
                description="Every physical parcel under this consignment, including processing outputs."
              />
            </div>

            {lots.length === 0 ? (
              <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
                No lots yet. A lot is created when the goods receipt is posted.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {lots.map((lot) => (
                  <li
                    key={lot.id}
                    className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
                  >
                    <span className="numeric shrink-0 font-medium">{lot.reference}</span>
                    <LotStatusBadge status={lot.status as LotStatus} size="sm" />
                    {lot.classificationName ? (
                      <span className="text-xs text-[var(--text-secondary)]">
                        {lot.classificationName}
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-tertiary)]">
                      {lot.roomCode && lot.locationCode
                        ? `${lot.roomCode} · ${lot.locationCode}`
                        : 'Not placed'}
                    </span>
                    <Quantity
                      quantityKg={lot.quantityKg}
                      keshaCount={lot.keshaCount}
                      size="sm"
                      layout="stacked"
                      className="items-end"
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ── The passport ─────────────────────────────────────────────── */}
          <Card padded={false}>
            <div className="p-4 sm:p-5">
              <CardHeader
                title="Coffee passport"
                description="Every event and every movement, derived from the append-only record."
              />
            </div>

            {passport.length === 0 ? (
              <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
                Nothing recorded yet.
              </p>
            ) : (
              <ol className="space-y-0 px-4 pb-5 sm:px-5">
                {passport.map((entry, index) => (
                  <PassportRow
                    key={`${entry.kind}-${entry.occurredAt.toISOString()}-${index}`}
                    entry={entry}
                    isLast={index === passport.length - 1}
                  />
                ))}
              </ol>
            )}
          </Card>
        </div>

        {/* ── Details sidebar ────────────────────────────────────────────── */}
        <div className="space-y-5">
          <Card>
            <CardHeader title="Details" />
            <FieldGrid columns={2}>
              <Field label="Customer">
                <Link
                  href={`/customers/${consignment.customerId}`}
                  className="rounded text-[var(--text-brand)] hover:underline"
                >
                  {consignment.customerName}
                </Link>
              </Field>
              <Field label="Branch">{consignment.branchName ?? '—'}</Field>
              <Field label="Coffee type">{consignment.coffeeTypeName ?? '—'}</Field>
              <Field label="Grade">{consignment.coffeeGradeName ?? '—'}</Field>
              <Field label="Origin">{consignment.originWoredaName ?? '—'}</Field>
              <Field label="Harvest year">{consignment.harvestYearName ?? '—'}</Field>
              <Field label="Expected">
                <OnDate value={consignment.expectedArrivalOn} />
              </Field>
              <Field label="Arrived">
                <When value={consignment.receivedAt} />
              </Field>
            </FieldGrid>

            {consignment.deliveryRequestId ? (
              <p className="mt-4 border-t border-[var(--border-subtle)] pt-4 text-sm">
                From delivery request{' '}
                <Link
                  href={`/delivery-requests/${consignment.deliveryRequestId}`}
                  className="numeric rounded font-medium text-[var(--text-brand)] hover:underline"
                >
                  {consignment.deliveryRequestReference}
                </Link>
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </div>
  )
}

function QuantityBlock({
  label,
  quantityKg,
  keshaCount,
  hint,
  emphasis = false,
}: {
  readonly label: string
  readonly quantityKg: string | null
  readonly keshaCount: number | null
  readonly hint: string
  readonly emphasis?: boolean
}) {
  return (
    <div
      className={`rounded-md p-3 ${emphasis ? 'bg-brand-50 dark:bg-brand-900/25' : 'bg-[var(--surface-sunken)]'}`}
    >
      <p className="text-2xs font-medium tracking-wide text-[var(--text-secondary)] uppercase">
        {label}
      </p>
      <div className="mt-1.5">
        {quantityKg ? (
          <Quantity
            quantityKg={quantityKg}
            keshaCount={keshaCount ?? 0}
            size="md"
            layout="stacked"
          />
        ) : (
          <span className="text-sm text-[var(--text-tertiary)]">Not recorded</span>
        )}
      </div>
      <p className="mt-1 text-2xs text-[var(--text-tertiary)]">{hint}</p>
    </div>
  )
}

/**
 * One passport entry.
 *
 * Movements show a signed quantity because direction is the whole meaning of a ledger row —
 * "−450 kg issued to processing" and "+450 kg received" are different facts, and a bare
 * magnitude makes the timeline unreadable.
 */
function PassportRow({
  entry,
  isLast,
}: {
  readonly entry: PassportEntry
  readonly isLast: boolean
}) {
  const isMovement = entry.kind === 'MOVEMENT'
  const signed = entry.quantityKg ? Number(entry.quantityKg) : null

  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={`mt-1.5 size-2.5 shrink-0 rounded-full ring-2 ring-[var(--surface-raised)] ${
            isMovement ? 'bg-coffee-700' : 'bg-brand-700'
          }`}
          aria-hidden
        />
        {!isLast ? (
          <span className="w-px flex-1 bg-[var(--border-subtle)]" aria-hidden />
        ) : null}
      </div>

      <div className="min-w-0 flex-1 pb-5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-medium">{statusLabel(entry.label)}</span>
          {signed !== null ? (
            <span
              className={`numeric text-sm font-semibold ${
                signed < 0
                  ? 'text-danger-700 dark:text-danger-100'
                  : 'text-[var(--text-secondary)]'
              }`}
            >
              {signed > 0 ? '+' : ''}
              {entry.quantityKg} kg
              {entry.keshaCount ? ` · ${entry.keshaCount} kesha` : ''}
            </span>
          ) : null}
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-tertiary)]">
          <When value={entry.occurredAt} />
          {entry.actorName ? <span>· {entry.actorName}</span> : null}
          {entry.aggregateType ? <span>· {entry.aggregateType}</span> : null}
        </div>
      </div>
    </li>
  )
}

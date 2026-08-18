import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import {
  warehouseTree,
  activeReservations,
  type WarehouseTree,
  type SectionCapacity,
  type ReservationRow,
} from '@modules/warehouse'
import { PageHeader, Card, CardHeader, EmptyState } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { Quantity } from '@ui/patterns/Quantity'
import { When } from '@ui/patterns/DateTime'
import { StatusChip } from '@ui/patterns/StatusChip'
import { Icon } from '@ui/layout/Icon'

export const metadata: Metadata = { title: 'Warehouse' }

/**
 * M12 — warehouse capacity.
 *
 * Occupancy counts RESERVED space as used. Space promised to an approved delivery is not
 * available to promise again, and a screen that shows it as free is how ten requests all fit
 * on Monday and none of them do on Friday.
 *
 * Nothing here is cached. A stale occupancy figure means coffee accepted against space that
 * does not exist.
 */
export default async function WarehousePage() {
  const { readiness } = await pageContext()

  const [tree, reservations] = await Promise.all([
    pageQuery([] as WarehouseTree[], warehouseTree),
    pageQuery([] as ReservationRow[], activeReservations),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouse"
        description="Rooms and sections, with live capacity. Reserved space counts as used — it has already been promised."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      {tree.length === 0 ? (
        <EmptyState
          title="No warehouses configured"
          description="Add a warehouse, its rooms and their sections in Administration before coffee can be received — every kilogram must be at a defined location."
          icon={<Icon name="warehouse" className="size-8" />}
        />
      ) : (
        tree.map((warehouse) => (
          <section key={warehouse.warehouseId} className="space-y-4">
            <h2 className="text-lg font-semibold">
              {warehouse.warehouseName}
              <span className="numeric ml-2 text-sm font-normal text-[var(--text-tertiary)]">
                {warehouse.warehouseCode}
              </span>
            </h2>

            <div className="grid gap-4 lg:grid-cols-2">
              {warehouse.rooms.map((room) => (
                <Card key={room.roomId}>
                  <CardHeader
                    title={room.roomName}
                    description={`${room.roomCode} · ${room.sections.length} section${room.sections.length === 1 ? '' : 's'}`}
                    action={
                      <span
                        className={`numeric text-sm font-semibold ${occupancyClass(room.occupancyPct)}`}
                      >
                        {room.occupancyPct}%
                      </span>
                    }
                  />

                  <ul className="mt-4 space-y-3">
                    {room.sections.map((section) => (
                      <SectionRow key={section.locationId} section={section} />
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          </section>
        ))
      )}

      {/* ── Reservations ──────────────────────────────────────────────────── */}
      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Active reservations"
            description="Space held for approved deliveries. A reservation that expires releases its space automatically."
          />
        </div>

        {reservations.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
            No active reservations.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {reservations.map((reservation) => (
              <li
                key={reservation.id}
                className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"
              >
                <span className="numeric shrink-0 text-sm font-medium">
                  {reservation.roomCode} · {reservation.sectionCode}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">
                  {reservation.customerName}
                </span>
                {reservation.deliveryRequestReference ? (
                  <span className="numeric shrink-0 text-xs text-[var(--text-tertiary)]">
                    {reservation.deliveryRequestReference}
                  </span>
                ) : null}
                <Quantity
                  quantityKg={reservation.quantityKg}
                  keshaCount={reservation.keshaCount}
                  size="sm"
                />
                <span
                  className={`shrink-0 text-xs ${
                    reservation.isExpiring
                      ? 'font-medium text-warning-900 dark:text-warning-100'
                      : 'text-[var(--text-tertiary)]'
                  }`}
                >
                  {reservation.isExpiring ? 'Expires ' : 'until '}
                  <When value={reservation.expiresAt} />
                </span>
                <StatusChip status={reservation.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function occupancyClass(pct: number): string {
  if (pct >= 90) return 'text-danger-700 dark:text-danger-100'
  if (pct >= 75) return 'text-warning-900 dark:text-warning-100'
  return 'text-[var(--text-secondary)]'
}

function SectionRow({ section }: { readonly section: SectionCapacity }) {
  const barClass =
    section.occupancyPct >= 90
      ? 'bg-danger-500'
      : section.occupancyPct >= 75
        ? 'bg-warning-500'
        : 'bg-brand-700'

  return (
    <li>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="numeric font-medium">
          {section.sectionCode}
          {section.isLossAccount ? (
            <span
              className="ml-2 rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-2xs font-normal text-[var(--text-tertiary)]"
              title="Virtual section receiving process loss. Never physically occupied."
            >
              Loss account
            </span>
          ) : null}
        </span>
        <span
          className={`numeric text-xs font-semibold ${occupancyClass(section.occupancyPct)}`}
        >
          {section.occupancyPct}%
        </span>
      </div>

      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
        role="progressbar"
        aria-valuenow={section.occupancyPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${section.sectionCode} occupancy`}
      >
        <div
          className={`h-full rounded-full ${barClass}`}
          style={{ width: `${Math.min(section.occupancyPct, 100)}%` }}
        />
      </div>

      <p className="numeric mt-1 text-2xs text-[var(--text-tertiary)]">
        {section.onHandKg} kg held
        {Number(section.reservedKg) > 0 ? ` · ${section.reservedKg} kg reserved` : ''} ·{' '}
        {section.freeKg} kg free of {section.usableKg} usable
      </p>
    </li>
  )
}

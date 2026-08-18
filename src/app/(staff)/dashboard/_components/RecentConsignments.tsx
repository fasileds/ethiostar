import Link from 'next/link'
import { Card, CardHeader, EmptyState } from '@ui/patterns/Card'
import { Quantity } from '@ui/patterns/Quantity'
import { Icon } from '@ui/layout/Icon'
import { ConsignmentStatusBadge } from '@modules/consignment/ui/StatusBadge'
import type { ConsignmentStatus } from '@modules/consignment'
import type { RecentConsignment } from '@modules/portal'

/**
 * The most recent consignments.
 *
 * Quantity is deliberately allowed to be absent: a consignment exists from the moment a
 * delivery request is approved, but it has no weight until the goods receipt is recorded.
 * Showing "0 kg" there would be a lie, so the column says "Not yet weighed" instead.
 */
export function RecentConsignments({ rows }: { readonly rows: readonly RecentConsignment[] }) {
  return (
    <Card className="lg:col-span-3" padded={false}>
      <div className="p-4 sm:p-5">
        <CardHeader
          title="Recent consignments"
          description="Most recently received or created."
          action={
            <Link
              href="/consignments"
              className="rounded text-sm font-medium text-[var(--text-brand)] hover:underline"
            >
              View all
            </Link>
          }
        />
      </div>

      {rows.length === 0 ? (
        <div className="px-4 pb-5 sm:px-5">
          <EmptyState
            title="No consignments yet"
            description="A consignment is created when a delivery request is approved. Approve one to see it here."
            icon={<Icon name="consignments" className="size-8" />}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-y border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
              <tr className="text-2xs tracking-wide text-[var(--text-secondary)] uppercase">
                <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                  Reference
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Customer
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium sm:px-5">
                  Quantity
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-[var(--surface-sunken)]">
                  <td className="px-4 py-2.5 sm:px-5">
                    <Link
                      href={`/consignments/${row.id}`}
                      className="numeric rounded font-medium text-[var(--text-brand)] hover:underline"
                    >
                      {row.reference}
                    </Link>
                  </td>
                  <td className="max-w-[14rem] truncate px-4 py-2.5 text-[var(--text-secondary)]">
                    {row.customerName ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <ConsignmentStatusBadge
                      status={row.status as ConsignmentStatus}
                      size="sm"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right sm:px-5">
                    {row.quantityKg ? (
                      <Quantity
                        quantityKg={row.quantityKg}
                        keshaCount={row.keshaCount ?? 0}
                        size="sm"
                        layout="stacked"
                        className="items-end"
                      />
                    ) : (
                      <span className="text-xs text-[var(--text-tertiary)]">
                        Not yet weighed
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

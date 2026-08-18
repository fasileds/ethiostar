import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import {
  keshaPositions,
  keshaTotals,
  listKeshaMovements,
  listReconciliations,
  type KeshaPosition,
} from '@modules/kesha'
import { PageHeader, Card, CardHeader, StatCard, EmptyState } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { StatusChip, statusLabel } from '@ui/patterns/StatusChip'
import { When, OnDate } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'
import { Alert } from '@ui/primitives/Alert'

export const metadata: Metadata = { title: 'Kesha' }

/**
 * M13 — kesha (bag) positions.
 *
 * Each row shows the balance projection AND the ledger sum, and flags any drift between them.
 * A screen that showed only the projection could never reveal that the two had diverged —
 * which is the exact failure this module exists to catch, since the bags are the customer's
 * property and the count is argued about from memory today.
 */
export default async function KeshaPage() {
  const { readiness } = await pageContext()

  const [totals, positions, movements, reconciliations] = await Promise.all([
    pageQuery({ heldFull: 0, heldEmpty: 0, damaged: 0, customers: 0 }, keshaTotals),
    pageQuery([] as KeshaPosition[], (tx) => keshaPositions(tx)),
    pageQuery({ items: [], hasMore: false, nextCursor: null }, (tx) =>
      listKeshaMovements(tx, { limit: 12 }),
    ),
    pageQuery({ items: [], hasMore: false, nextCursor: null }, (tx) =>
      listReconciliations(tx, { limit: 8 }),
    ),
  ])

  const drifting = positions.filter((position) => position.drift !== 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kesha"
        description="The customer's bags, counted separately from the coffee inside them. The ledger is append-only; the balance is a projection of it."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      {drifting.length > 0 ? (
        <Alert tone="danger" title="The kesha ledger and the balance disagree">
          <p>
            {drifting.length} {drifting.length === 1 ? 'position' : 'positions'} where the sum
            of movements does not match the recorded balance. The ledger is authoritative —
            rebuild the projection rather than editing a balance.
          </p>
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Held full"
          intent="brand"
          value={<span className="numeric text-3xl font-semibold">{totals.heldFull}</span>}
          hint="Bags of customer coffee"
          icon={<Icon name="bags" />}
        />
        <StatCard
          label="Held empty"
          value={<span className="numeric text-3xl font-semibold">{totals.heldEmpty}</span>}
          hint="Emptied into processing"
          icon={<Icon name="bags" />}
        />
        <StatCard
          label="Damaged"
          intent={totals.damaged > 0 ? 'warn' : 'neutral'}
          value={<span className="numeric text-3xl font-semibold">{totals.damaged}</span>}
          hint="Awaiting settlement"
          icon={<Icon name="bags" />}
        />
        <StatCard
          label="Customers"
          value={<span className="numeric text-3xl font-semibold">{totals.customers}</span>}
          hint="With a kesha position"
          icon={<Icon name="customers" />}
        />
      </div>

      {/* ── Positions ─────────────────────────────────────────────────────── */}
      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Positions by customer"
            description="Ledger and projection, side by side."
          />
        </div>

        {positions.length === 0 ? (
          <div className="px-4 pb-5 sm:px-5">
            <EmptyState
              title="No kesha recorded"
              description="Positions appear once a goods receipt records the bags that arrived with a delivery."
              icon={<Icon name="bags" className="size-8" />}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-y border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
                <tr className="text-2xs tracking-wide text-[var(--text-secondary)] uppercase">
                  <th scope="col" className="px-4 py-2 font-medium sm:px-5">
                    Customer
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Bag type
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Full
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Empty
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Damaged
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Ledger
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium sm:px-5">
                    Drift
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {positions.map((position) => (
                  <tr
                    key={`${position.customerId}-${position.bagTypeId ?? 'none'}`}
                    className="hover:bg-[var(--surface-sunken)]"
                  >
                    <td className="max-w-[16rem] truncate px-4 py-2.5 sm:px-5">
                      {position.customerName}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                      {position.bagTypeName ?? 'Unspecified'}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right">{position.heldFull}</td>
                    <td className="numeric px-4 py-2.5 text-right">{position.heldEmpty}</td>
                    <td className="numeric px-4 py-2.5 text-right">
                      {position.damaged > 0 ? (
                        <span className="text-warning-900 dark:text-warning-100">
                          {position.damaged}
                        </span>
                      ) : (
                        position.damaged
                      )}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right text-[var(--text-secondary)]">
                      {position.ledgerHeld}
                    </td>
                    <td className="numeric px-4 py-2.5 text-right sm:px-5">
                      {position.drift === 0 ? (
                        <span className="text-[var(--text-tertiary)]">—</span>
                      ) : (
                        <span className="font-semibold text-danger-700 dark:text-danger-100">
                          {position.drift > 0 ? '+' : ''}
                          {position.drift}
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

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Reconciliations ─────────────────────────────────────────────── */}
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Physical counts"
              description="A posted count with a variance must explain it."
            />
          </div>
          {reconciliations.items.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
              No counts recorded.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {reconciliations.items.map((row) => (
                <li key={row.id} className="px-4 py-3 sm:px-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="numeric font-medium">{row.reference}</span>
                    <StatusChip status={row.status} />
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">
                      {row.customerName}
                    </span>
                    <OnDate
                      value={row.countedOn}
                      className="text-xs text-[var(--text-tertiary)]"
                    />
                  </div>
                  <p className="numeric mt-1 text-xs text-[var(--text-secondary)]">
                    Full {row.countedFull} of {row.expectedFull}
                    {row.varianceFull !== 0 ? (
                      <span className="font-semibold text-danger-700 dark:text-danger-100">
                        {' '}
                        ({row.varianceFull > 0 ? '+' : ''}
                        {row.varianceFull})
                      </span>
                    ) : null}
                    {' · '}Empty {row.countedEmpty} of {row.expectedEmpty}
                    {row.varianceEmpty !== 0 ? (
                      <span className="font-semibold text-danger-700 dark:text-danger-100">
                        {' '}
                        ({row.varianceEmpty > 0 ? '+' : ''}
                        {row.varianceEmpty})
                      </span>
                    ) : null}
                  </p>
                  {row.varianceReason ? (
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                      {row.varianceReason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Movements ───────────────────────────────────────────────────── */}
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader
              title="Recent movements"
              description="Append-only. Nothing here edits."
            />
          </div>
          {movements.items.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-[var(--text-tertiary)] sm:px-5">
              No movements recorded.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {movements.items.map((movement) => (
                <li key={movement.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <span
                    className={`numeric w-12 shrink-0 text-right text-sm font-semibold ${
                      movement.keshaDelta < 0
                        ? 'text-danger-700 dark:text-danger-100'
                        : 'text-success-700 dark:text-success-100'
                    }`}
                  >
                    {movement.keshaDelta > 0 ? '+' : ''}
                    {movement.keshaDelta}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--text-secondary)]">
                    {statusLabel(movement.movementType)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-tertiary)]">
                    {movement.customerName}
                  </span>
                  <When
                    value={movement.occurredAt}
                    className="shrink-0 text-xs text-[var(--text-tertiary)]"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

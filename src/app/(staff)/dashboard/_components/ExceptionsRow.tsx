import { StatCard } from '@ui/patterns/Card'
import { Icon } from '@ui/layout/Icon'
import type { OperationalDashboardData } from '@modules/reporting'

/**
 * "Today's exceptions" (M21) — the three things that mean something on the floor went wrong
 * today, rather than merely being busy: a job closed outside mass-balance tolerance, a stock
 * adjustment posted against an exception reason code, an invoice that fell overdue.
 */
export function ExceptionsRow({
  exceptions,
}: {
  readonly exceptions: OperationalDashboardData['exceptionsToday']
}) {
  const tiles = [
    {
      label: 'Mass-balance exceptions',
      count: exceptions.massBalanceExceptions,
      hint: 'Jobs closed outside tolerance today',
      href: '/processing',
      icon: 'processing',
    },
    {
      label: 'Flagged adjustments',
      count: exceptions.flaggedAdjustments,
      hint: 'Posted against an exception reason code today',
      href: '/stock',
      icon: 'stock',
    },
    {
      label: 'Overdue invoices',
      count: exceptions.overdueInvoices,
      hint: 'Past due date, unpaid',
      href: '/billing',
      icon: 'documents',
    },
  ] as const

  return (
    <section aria-labelledby="exceptions">
      <h2 id="exceptions" className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
        Today&apos;s exceptions
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        {tiles.map((tile) => (
          <StatCard
            key={tile.label}
            label={tile.label}
            intent={tile.count > 0 ? 'danger' : 'neutral'}
            value={<span className="numeric text-3xl font-semibold">{tile.count}</span>}
            hint={tile.hint}
            href={tile.href}
            icon={<Icon name={tile.icon} />}
          />
        ))}
      </div>
    </section>
  )
}

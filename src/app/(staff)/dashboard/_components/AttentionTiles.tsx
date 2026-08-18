import { StatCard } from '@ui/patterns/Card'
import { Icon } from '@ui/layout/Icon'
import type { OperationalCounts } from '@modules/portal'

/**
 * "Needs attention" — the four things waiting on a human decision.
 *
 * Each tile turns amber only when its count is non-zero, so a quiet plant shows a calm
 * screen and a busy one shows exactly where the queue is. A dashboard where everything is
 * always coloured teaches an operator to ignore colour.
 */
export function AttentionTiles({ counts }: { readonly counts: OperationalCounts }) {
  const tiles = [
    {
      label: 'Applications',
      count: counts.pendingApplications,
      hint: 'Awaiting review',
      href: '/applications',
      icon: 'applications',
      intent: 'warn',
    },
    {
      label: 'Delivery requests',
      count: counts.pendingDeliveryRequests,
      hint: 'Awaiting approval',
      href: '/delivery-requests',
      icon: 'delivery',
      intent: 'warn',
    },
    {
      label: 'Awaiting acceptance',
      count: counts.awaitingAcceptance,
      hint: 'Mirt Merekebiya to sign',
      href: '/acceptance',
      icon: 'acceptance',
      intent: 'brand',
    },
    {
      label: 'Awaiting dispatch',
      count: counts.pendingReleases,
      hint: 'Release requested',
      href: '/dispatch',
      icon: 'dispatch',
      intent: 'brand',
    },
  ] as const

  return (
    <section aria-labelledby="attention">
      <h2 id="attention" className="sr-only">
        Needs attention
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {tiles.map((tile) => (
          <StatCard
            key={tile.label}
            label={tile.label}
            intent={tile.count > 0 ? tile.intent : 'neutral'}
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

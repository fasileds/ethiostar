import Link from 'next/link'
import { Card, CardHeader } from '@ui/patterns/Card'
import type { RoomOccupancy } from '@modules/portal'

/**
 * Store occupancy.
 *
 * Reads a live view, never a materialized one: a stale occupancy figure means coffee
 * accepted against space that does not exist, which is exactly what the M11 control exists
 * to prevent.
 *
 * The thresholds (75% amber, 90% red) are display defaults; the OPERATIONAL threshold that
 * blocks acceptance is `safe_fill_pct` per section, held in the database.
 */
export function OccupancyPanel({ sections }: { readonly sections: readonly RoomOccupancy[] }) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Store occupancy"
        description="Live — never cached."
        action={
          <Link
            href="/warehouse"
            className="rounded text-sm font-medium text-[var(--text-brand)] hover:underline"
          >
            Manage
          </Link>
        }
      />

      {sections.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--text-tertiary)]">
          No storage sections configured yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {sections.slice(0, 8).map((section) => {
            const tone =
              section.occupancyPct >= 90
                ? { text: 'text-danger-700 dark:text-danger-100', bar: 'bg-danger-500' }
                : section.occupancyPct >= 75
                  ? { text: 'text-warning-900 dark:text-warning-100', bar: 'bg-warning-500' }
                  : { text: 'text-[var(--text-secondary)]', bar: 'bg-brand-700' }

            return (
              <li key={section.locationId}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium">
                    {section.roomCode}
                    <span className="text-[var(--text-tertiary)]">
                      {' '}
                      · {section.sectionCode}
                    </span>
                  </span>
                  <span className={`numeric text-xs font-semibold ${tone.text}`}>
                    {section.occupancyPct}%
                  </span>
                </div>
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
                  role="progressbar"
                  aria-valuenow={section.occupancyPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${section.roomCode} ${section.sectionCode} occupancy`}
                >
                  <div
                    className={`h-full rounded-full ${tone.bar}`}
                    style={{ width: `${Math.min(section.occupancyPct, 100)}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { pageContext } from '@server/page-data'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { Icon } from '@ui/layout/Icon'
import type { IconName } from '@ui/layout/navigation'

export const metadata: Metadata = { title: 'Administration' }

/**
 * M23 — the administration hub.
 *
 * Deliberately a directory rather than a settings form. Master data in this system is
 * EFFECTIVE-DATED — a bag type's tare weight is versioned, because changing it must not
 * restate the kesha reconciliation of a delivery received last season. That is not something
 * a flat "edit and save" screen can express honestly, so each area gets its own screen with
 * its own versioning rules.
 */

const AREAS: ReadonlyArray<{
  readonly title: string
  readonly description: string
  readonly href: string
  readonly icon: IconName
  readonly permission: string
}> = [
  {
    title: 'Users and roles',
    description:
      'Who can do what. Every action is attributable to a named user; shared accounts are not permitted.',
    href: '/admin/users',
    icon: 'profile',
    permission: 'admin:manage_users',
  },
  {
    title: 'Branches and warehouses',
    description:
      'Sites, rooms and sections. Every kilogram must sit at a defined location, so this is where those locations come from.',
    href: '/admin/warehouses',
    icon: 'warehouse',
    permission: 'admin:manage_settings',
  },
  {
    title: 'Coffee master data',
    description: 'Types, grades, screen sizes, certifications, harvest years and origins.',
    href: '/admin/coffee',
    icon: 'consignments',
    permission: 'admin:manage_settings',
  },
  {
    title: 'Bag types',
    description:
      'Kesha types and their tare weights. Effective-dated — a new tare applies forward, never backwards.',
    href: '/admin/bag-types',
    icon: 'bags',
    permission: 'admin:manage_settings',
  },
  {
    title: 'Machines and capacity',
    description: 'Processing lines, their rated throughput, and the working day they can take.',
    href: '/admin/machines',
    icon: 'processing',
    permission: 'admin:manage_settings',
  },
  {
    title: 'Labour rates',
    description:
      'Piece rates by activity, effective-dated. A rate change never restates what was already earned.',
    href: '/admin/labour-rates',
    icon: 'labour',
    permission: 'admin:manage_settings',
  },
  {
    title: 'Reason codes',
    description:
      'The controlled vocabulary behind adjustments, delays and variances — so exceptions can be counted, not just read.',
    href: '/admin/reason-codes',
    icon: 'audit',
    permission: 'admin:manage_settings',
  },
  {
    title: 'Document templates',
    description: 'Layouts for goods receipts, gate passes, acceptances and delivery notes.',
    href: '/admin/templates',
    icon: 'printing',
    permission: 'admin:manage_settings',
  },
  {
    title: 'Notification templates',
    description:
      'Message bodies in English and Amharic, versioned so a sent message can be replayed.',
    href: '/admin/notifications',
    icon: 'documents',
    permission: 'admin:manage_settings',
  },
  {
    title: 'System settings',
    description:
      'Tolerances, reservation windows and thresholds. Every change is versioned with who made it.',
    href: '/admin/settings',
    icon: 'admin',
    permission: 'admin:manage_settings',
  },
  {
    title: 'Storage rates',
    description:
      'M20 — the tiered per-kg-per-day storage rate by branch, and where storage/demurrage charging is run.',
    href: '/admin/storage-rates',
    icon: 'warehouse',
    permission: 'billing:manage_storage_rates',
  },
  {
    title: 'Workflow definitions',
    description:
      'The steps every approval routes through, per entity type — configuration, not code, when who-approves-what changes.',
    href: '/admin/workflows',
    icon: 'tasks',
    permission: 'workflow:manage_definitions',
  },
]

export default async function AdminPage() {
  const { readiness, actor } = await pageContext()
  const permissions = actor?.permissions ?? new Set<string>()

  // Filtered by permission as a courtesy, exactly as the nav is. The real check happens in
  // each area's own use case, next to the data.
  const visible = AREAS.filter(
    (area) => permissions.size === 0 || permissions.has(area.permission),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration"
        description="Configuration behind the operational screens. Master data here is effective-dated, so changes apply forward without restating history."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((area) => (
          <Link
            key={area.href}
            href={area.href}
            className="group rounded-lg bg-[var(--surface-raised)] p-4 ring-1 ring-[var(--border-subtle)] transition-shadow hover:shadow-md sm:p-5"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0 text-[var(--text-brand)]">
                <Icon name={area.icon} />
              </span>
              <div className="min-w-0">
                <h3 className="font-semibold group-hover:underline">{area.title}</h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{area.description}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Migrations are applied separately"
          description="Schema changes ship as reviewed SQL in supabase/migrations and are applied by an operator, never by the application at runtime."
        />
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          See <code className="numeric text-xs">docs/phase-1/MIGRATIONS.md</code> for the order
          they run in and what to verify once they are applied.
        </p>
      </Card>
    </div>
  )
}

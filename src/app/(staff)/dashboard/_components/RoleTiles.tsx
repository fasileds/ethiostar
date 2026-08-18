import { StatCard, Card, CardHeader } from '@ui/patterns/Card'
import { Icon } from '@ui/layout/Icon'
import type { RoleDashboardData } from '@modules/reporting'

/**
 * Role-specific tiles (M21) — General Manager and Finance Officer see throughput, revenue,
 * occupancy and receivables; Store Manager sees capacity, ageing and today's movements;
 * Production Operator sees today's jobs and machine status. A role with none of these
 * (Store Keeper, Security Officer, …) renders nothing here — the tiles above already cover
 * what they need.
 */
export function RoleTiles({ data }: { readonly data: RoleDashboardData | null }) {
  if (!data || data.kind === 'operational') return null

  if (data.kind === 'general_manager') {
    return (
      <section aria-labelledby="role-tiles">
        <h2 id="role-tiles" className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
          Your view
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard
            label="Throughput this month"
            value={
              <span className="numeric text-2xl font-semibold">
                {Number(data.throughputKgThisMonth).toLocaleString('en-US')} kg
              </span>
            }
            icon={<Icon name="processing" />}
          />
          <StatCard
            label="Revenue this month"
            value={
              <span className="numeric text-2xl font-semibold">
                {Number(data.revenueThisMonth).toLocaleString('en-US')}
              </span>
            }
            href="/reports/commercial/revenue-by-customer"
            icon={<Icon name="documents" />}
          />
          <StatCard
            label="Occupancy"
            value={<span className="numeric text-2xl font-semibold">{data.occupancyPct}%</span>}
            href="/warehouse"
            icon={<Icon name="warehouse" />}
          />
          <StatCard
            label="Receivables outstanding"
            intent={data.overdueInvoiceCount > 0 ? 'warn' : 'neutral'}
            value={
              <span className="numeric text-2xl font-semibold">
                {Number(data.receivablesOutstanding).toLocaleString('en-US')}
              </span>
            }
            hint={`${data.overdueInvoiceCount} invoice${data.overdueInvoiceCount === 1 ? '' : 's'} overdue`}
            href="/reports/commercial/receivables-ageing"
            icon={<Icon name="documents" />}
          />
        </div>
      </section>
    )
  }

  if (data.kind === 'store_manager') {
    return (
      <section aria-labelledby="role-tiles" className="space-y-4">
        <h2 id="role-tiles" className="text-sm font-medium text-[var(--text-secondary)]">
          Your view
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <StatCard
            label="Ageing stock — 30+ days"
            value={
              <span className="numeric text-2xl font-semibold">
                {data.ageingStock.over30Days}
              </span>
            }
            href="/reports/inventory/ageing-stock"
            icon={<Icon name="stock" />}
          />
          <StatCard
            label="Ageing stock — 60+ days"
            intent={data.ageingStock.over60Days > 0 ? 'warn' : 'neutral'}
            value={
              <span className="numeric text-2xl font-semibold">
                {data.ageingStock.over60Days}
              </span>
            }
            href="/reports/inventory/ageing-stock"
            icon={<Icon name="stock" />}
          />
          <StatCard
            label="Ageing stock — 90+ days"
            intent={data.ageingStock.over90Days > 0 ? 'danger' : 'neutral'}
            value={
              <span className="numeric text-2xl font-semibold">
                {data.ageingStock.over90Days}
              </span>
            }
            href="/reports/inventory/ageing-stock"
            icon={<Icon name="stock" />}
          />
        </div>
        {data.capacityByWarehouse.length > 0 ? (
          <Card>
            <CardHeader
              title="Capacity by warehouse"
              description={`${data.movementsToday} movement(s) today`}
            />
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.capacityByWarehouse.map((wh) => (
                <div
                  key={wh.warehouseName}
                  className="rounded-md bg-[var(--surface-sunken)] p-3"
                >
                  <p className="text-sm font-medium">{wh.warehouseName}</p>
                  <p className="numeric mt-1 text-lg font-semibold">{wh.occupancyPct}%</p>
                  <p className="numeric text-xs text-[var(--text-tertiary)]">
                    {Number(wh.usedKg).toLocaleString('en-US')} /{' '}
                    {Number(wh.capacityKg).toLocaleString('en-US')} kg
                  </p>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </section>
    )
  }

  return (
    <section aria-labelledby="role-tiles">
      <h2 id="role-tiles" className="mb-3 text-sm font-medium text-[var(--text-secondary)]">
        Your view
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard
          label="Scheduled today"
          value={
            <span className="numeric text-2xl font-semibold">{data.jobsScheduledToday}</span>
          }
          href="/scheduling"
          icon={<Icon name="calendar" />}
        />
        <StatCard
          label="In progress"
          intent={data.jobsInProgress > 0 ? 'success' : 'neutral'}
          value={<span className="numeric text-2xl font-semibold">{data.jobsInProgress}</span>}
          href="/processing"
          icon={<Icon name="processing" />}
        />
        <StatCard
          label="Machines running"
          value={
            <span className="numeric text-2xl font-semibold">
              {data.machineStatus.filter((m) => m.isRunning).length} /{' '}
              {data.machineStatus.length}
            </span>
          }
          icon={<Icon name="processing" />}
        />
      </div>
    </section>
  )
}

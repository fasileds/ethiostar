import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { listAllMachines, type MachineAdminRow } from '@modules/scheduling'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { MachinesClient } from './MachinesClient'

export const metadata: Metadata = { title: 'Machines and capacity' }

/**
 * M14 — the processing lines the scheduler books capacity against: sorters, hullers,
 * graders, cleaners and polishers. Per-day capacity overrides (`machine_capacity_day`) are
 * routine operational data entry, not master data, and are not managed from this screen.
 */
export default async function MachinesPage() {
  const { readiness } = await pageContext()

  const machines = await pageQuery([] as MachineAdminRow[], (tx) => listAllMachines(tx))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Machines and capacity"
        description="Processing lines, their rated throughput, and the operational status the scheduler reads."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Machines"
            description="Add a machine, or change its status when it goes down for maintenance or is retired."
          />
        </div>
        <div className="px-4 pb-5 sm:px-5">
          <MachinesClient machines={machines} />
        </div>
      </Card>
    </div>
  )
}

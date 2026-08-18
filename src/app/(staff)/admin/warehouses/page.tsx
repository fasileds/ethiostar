import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import {
  listBranches,
  warehouseAdminTree,
  type BranchOption,
  type AdminWarehouseRow,
} from '@modules/warehouse'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { WarehousesClient } from './WarehousesClient'

export const metadata: Metadata = { title: 'Branches and warehouses' }

/**
 * M12 — the location hierarchy every kilogram must sit inside. Warehouse → room → section,
 * each level scoped to the one above, each individually deactivatable without losing the
 * history that already referenced it.
 */
export default async function WarehousesPage() {
  const { readiness } = await pageContext()

  const branches = await pageQuery([] as BranchOption[], (tx) => listBranches(tx))
  const warehouses = await pageQuery([] as AdminWarehouseRow[], (tx) => warehouseAdminTree(tx))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Branches and warehouses"
        description="Sites, rooms and sections. Every kilogram must sit at a defined location, so this is where those locations come from."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Location hierarchy"
            description="Add a warehouse, a room within it, or a section within a room — or deactivate one that should no longer be offered."
          />
        </div>
        <div className="px-4 pb-5 sm:px-5">
          <WarehousesClient branches={branches} warehouses={warehouses} />
        </div>
      </Card>
    </div>
  )
}

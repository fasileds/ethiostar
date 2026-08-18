import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { listBagTypesWithVersions, type BagTypeRow } from '@modules/master-data'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { BagTypesClient } from './BagTypesClient'

export const metadata: Metadata = { title: 'Bag types' }

/**
 * M02 — kesha types and their standard tare/net weight.
 *
 * The type itself (code, name, ownership) is a stable identity. The weight is effective-dated
 * in `bag_type_version` — the key control being "changing a tariff does not retrospectively
 * alter invoices already raised under the old rate", so this screen never edits a weight in
 * place. It only ever adds a new version, effective forward.
 */
export default async function BagTypesPage() {
  const { readiness } = await pageContext()

  const bagTypes = await pageQuery([] as BagTypeRow[], (tx) => listBagTypesWithVersions(tx))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bag types"
        description="Kesha types and their tare/net weights. Effective-dated — a new weight applies forward, never backwards."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Bag types"
            description="Add a new bag type, or add a new weight version to an existing one — the previous version is closed, not overwritten."
          />
        </div>
        <div className="px-4 pb-5 sm:px-5">
          <BagTypesClient bagTypes={bagTypes} />
        </div>
      </Card>
    </div>
  )
}

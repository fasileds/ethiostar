import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import {
  listLabourRates,
  listLabourActivityTypes,
  listBranchesForLabourRate,
  type LabourRateRow,
  type LabourActivityTypeOption,
  type BranchOption,
} from '@modules/labour'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { LabourRatesClient } from './LabourRatesClient'

export const metadata: Metadata = { title: 'Labour rates' }

/**
 * M18 — the piece rate in force per branch, activity and rate basis, effective-dated.
 * A rate change never restates what a worker already earned — pay records copy the rate
 * they used, so this screen only ever ADDS a new version, never edits a historical one.
 */
export default async function LabourRatesPage() {
  const { readiness } = await pageContext()

  const rates = await pageQuery([] as LabourRateRow[], (tx) => listLabourRates(tx))
  const activityTypes = await pageQuery([] as LabourActivityTypeOption[], (tx) =>
    listLabourActivityTypes(tx),
  )
  const branches = await pageQuery([] as BranchOption[], (tx) => listBranchesForLabourRate(tx))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Labour rates"
        description="Piece rates by branch, activity and basis — effective-dated, so a change applies forward without restating what was already earned."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Rates"
            description="Adding a rate closes out the current open-ended version for the same branch, activity and basis, and opens a new one from the date chosen."
          />
        </div>
        <div className="px-4 pb-5 sm:px-5">
          <LabourRatesClient rates={rates} activityTypes={activityTypes} branches={branches} />
        </div>
      </Card>
    </div>
  )
}

import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import {
  listStorageRateTiers,
  listBranchesForBilling,
  type StorageRateTierRow,
} from '@modules/billing'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { StorageRatesClient } from './StorageRatesClient'

export const metadata: Metadata = { title: 'Storage rates' }

/**
 * M20 — the tiered per-kg-per-day storage rate, by branch and dwell-day threshold. Also
 * where staff run the periodic storage-charging sweep (`calculateStorageCharges`) — there is
 * no cron in this codebase, so a button is the deliberate substitute until worker
 * infrastructure exists.
 */
export default async function StorageRatesPage() {
  const { readiness } = await pageContext()

  const [tiers, branches] = await Promise.all([
    pageQuery([] as StorageRateTierRow[], listStorageRateTiers),
    pageQuery([] as Awaited<ReturnType<typeof listBranchesForBilling>>, listBranchesForBilling),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Storage rates"
        description="Per-kg-per-day rate tiers by branch, keyed to cumulative dwell time — a lot's day count in store, not the calendar."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Run storage charging"
            description="Prices every lot's un-charged dwell-time span since the last run, through today, applying free-storage days and the tiers below."
          />
        </div>
        <div className="px-4 pb-5 sm:px-5">
          <StorageRatesClient tiers={tiers} branches={branches} />
        </div>
      </Card>
    </div>
  )
}

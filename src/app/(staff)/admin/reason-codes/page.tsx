import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import {
  listReasonCodeCategories,
  listAllReasonCodes,
  type ReasonCodeCategoryRow,
  type ReasonCodeAdminRow,
} from '@modules/master-data'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { ReasonCodesClient } from './ReasonCodesClient'

export const metadata: Metadata = { title: 'Reason codes' }

/**
 * M02 — the controlled vocabulary behind every "explain why" control: stock adjustments,
 * schedule delays, variance overrides. Categories keep one table serving every module without
 * a delay reason being selectable for a stock adjustment (`reason_code_category`).
 */
export default async function ReasonCodesPage() {
  const { readiness } = await pageContext()

  const categories = await pageQuery([] as ReasonCodeCategoryRow[], (tx) =>
    listReasonCodeCategories(tx),
  )
  const codes = await pageQuery([] as ReasonCodeAdminRow[], (tx) => listAllReasonCodes(tx))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reason codes"
        description="The controlled vocabulary behind adjustments, delays and variances — so exceptions can be counted, not just read."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Codes by category"
            description="Add a code, or deactivate one that should no longer be offered — history that already used it is unaffected."
          />
        </div>
        <div className="px-4 pb-5 sm:px-5">
          <ReasonCodesClient categories={categories} codes={codes} />
        </div>
      </Card>
    </div>
  )
}

import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { listOpenHolds, type CreditHoldRow } from '@modules/billing'
import { PageHeader, Card } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { HoldsClient } from './HoldsClient'

export const metadata: Metadata = { title: 'Credit holds' }

/** M19 — open financial holds. `dispatch:record_gate_out` and `appointment:view` both
 *  check `financialHoldsFor` for these before letting a customer's coffee move. */
export default async function CreditHoldsPage() {
  const { readiness } = await pageContext()
  const holds = await pageQuery([] as CreditHoldRow[], listOpenHolds)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credit holds"
        description="Open financial holds — automatic on an overdue balance or a credit limit breach, or set manually."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        {holds.length === 0 ? (
          <p className="p-5 text-sm text-[var(--text-tertiary)]">No open holds.</p>
        ) : (
          <ul className="divide-y divide-[var(--border-subtle)]">
            {holds.map((hold) => (
              <HoldsClient key={hold.id} hold={hold} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

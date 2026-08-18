import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import type { LotStatus } from '@modules/consignment'
import type { ReleaseLot, HoldReason } from '../domain/clearance'

/** Per-lot facts the clearance domain needs, for every lot on a dispatch order. */
export async function releaseLotsFor(tx: Tx, dispatchOrderId: string): Promise<ReleaseLot[]> {
  const rows = await rawRows(
    tx,
    sql`
      select
        l.id, l.reference, l.status, l.output_classification_id is not null as was_processed,
        exists (
          select 1 from public.acceptance_line al
          join public.acceptance_record ar on ar.id = al.acceptance_id
          where al.lot_id = l.id and ar.status in ('ACCEPTED', 'PARTIALLY_ACCEPTED')
        ) as has_signed_acceptance
      from public.dispatch_line dl
      join public.lot l on l.id = dl.lot_id
      where dl.dispatch_order_id = ${dispatchOrderId}::uuid
    `,
  )

  return rows.map((row) => ({
    lotId: col.text(row.id),
    reference: col.text(row.reference),
    status: col.text(row.status) as LotStatus,
    wasProcessed: col.bool(row.was_processed),
    hasSignedAcceptance: col.bool(row.has_signed_acceptance),
  }))
}

/**
 * Customer holds — document compliance, in Phase 1 scope.
 *
 * `CustomerHoldPolicy` (docs/architecture/07-extension-points.md Seam 4) names this and a
 * financial hold as the two Phase 1/Phase 2 policies; the financial one is M19 (Phase 2).
 * Here, a SUSPENDED customer is the compliance signal — the `customer.status` column's own
 * comment says suspension is what blocks new activity, which is exactly a dispatch hold.
 */
export async function customerHoldsFor(tx: Tx, customerId: string): Promise<HoldReason[]> {
  const rows = await rawRows(
    tx,
    sql`select status, suspended_reason from public.customer where id = ${customerId}::uuid`,
  )
  const row = rows[0]
  if (!row || col.text(row.status) !== 'SUSPENDED') return []

  return [
    {
      code: 'CUSTOMER_ON_HOLD',
      message: col.textOrNull(row.suspended_reason) ?? 'This customer account is suspended.',
      overridableBy: 'dispatch:override_hold',
    },
  ]
}

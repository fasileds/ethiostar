import { sql } from 'drizzle-orm'
import { withServiceDb, type Tx } from '@db/client'
import { SYSTEM_ACTOR_ID } from '@modules/identity'
import type { JobContext } from './types'

/**
 * Balance reconciliation (Step 16 DoD).
 *
 * `fn_reconcile_stock_balance()` and `fn_rebuild_stock_balance()` already exist as database
 * functions (migration 0012) — the asymmetry the ledger design rests on (the projection can
 * be rebuilt from the ledger; the reverse is impossible) is expressed there, in SQL, once.
 * This handler is the scheduled caller: it runs the check, and if anything disagrees, it
 * logs the drift AT ERROR (a paging signal — silent drift means someone has been reading a
 * wrong stock figure) and then rebuilds, because the recovery is unconditionally safe and
 * there is no reason to leave a known-wrong projection serving reads until a human notices.
 */

interface DriftRow {
  lot_id: string
  location_id: string
  projected_kg: string
  ledger_kg: string
  projected_kesha: number
  ledger_kesha: number
}

export async function balanceReconciliation(ctx: JobContext): Promise<void> {
  const drift = await withServiceDb(SYSTEM_ACTOR_ID, 'stock:reconcile', (tx: Tx) =>
    tx.execute(sql`select * from public.fn_reconcile_stock_balance()`),
  )

  const rows = drift as unknown as DriftRow[]

  if (rows.length === 0) {
    ctx.log.debug('stock balance reconciliation: no drift')
    return
  }

  ctx.log.error(
    {
      driftCount: rows.length,
      sample: rows.slice(0, 5).map((r) => ({
        lotId: r.lot_id,
        locationId: r.location_id,
        projectedKg: r.projected_kg,
        ledgerKg: r.ledger_kg,
      })),
    },
    'stock balance projection disagrees with the ledger — rebuilding',
  )

  const rebuilt = await withServiceDb(SYSTEM_ACTOR_ID, 'stock:rebuild', (tx: Tx) =>
    tx.execute(sql`select public.fn_rebuild_stock_balance() as rows`),
  )
  const rebuiltRows = (rebuilt as unknown as Array<{ rows: string }>)[0]

  ctx.log.warn(
    { rebuiltRows: rebuiltRows?.rows ?? '0' },
    'stock balance projection rebuilt from the ledger',
  )
}

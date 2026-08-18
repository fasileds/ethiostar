import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { NotFoundError } from '@core/errors/app-error'

/**
 * The virtual section that receives `PROCESS_LOSS` movements for a branch.
 *
 * Loss is a destination in the ledger, not a second withdrawal (see `stock/domain/movement.ts`),
 * so it still needs a real `location_id` — this is what keeps "every kilogram is at a
 * defined location" true for the kilograms that became dust and chaff.
 */
export async function findLossAccountSection(tx: Tx, branchId: string): Promise<string> {
  const rows = await rawRows(
    tx,
    sql`
      select s.id
      from public.store_section s
      join public.store_room r on r.id = s.room_id
      join public.warehouse w on w.id = r.warehouse_id
      where w.branch_id = ${branchId}::uuid and s.is_loss_account and s.is_active
      order by s.created_at
      limit 1
    `,
  )
  const row = rows[0]
  if (!row) {
    throw NotFoundError.of('Loss-account section for branch', branchId)
  }
  return col.text(row.id)
}

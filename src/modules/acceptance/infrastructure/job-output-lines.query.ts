import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/** The non-loss outputs of a closed job, in the shape the acceptance pack needs. */
export interface JobOutputForAcceptance {
  readonly lotId: string
  readonly classificationId: string | null
  readonly quantityKg: string
  readonly keshaCount: number | null
}

export async function jobOutputsForAcceptance(
  tx: Tx,
  jobOrderId: string,
): Promise<JobOutputForAcceptance[]> {
  const rows = await rawRows(
    tx,
    sql`
      select lot_id, classification_id, quantity_kg, kesha_count
      from public.job_order_output
      where job_order_id = ${jobOrderId}::uuid and not is_loss and lot_id is not null
      order by line_no
    `,
  )

  return rows.map((row) => ({
    lotId: col.text(row.lot_id),
    classificationId: col.textOrNull(row.classification_id),
    quantityKg: col.numeric(row.quantity_kg),
    keshaCount: col.intOrNull(row.kesha_count),
  }))
}

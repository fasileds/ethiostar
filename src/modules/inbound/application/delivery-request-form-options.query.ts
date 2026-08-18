import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'

/** Reference data the portal's delivery-request form and the receiving form both offer. */
export interface FormOption {
  readonly id: string
  readonly name: string
}

export interface DeliveryRequestFormOptions {
  readonly coffeeTypes: readonly FormOption[]
  readonly coffeeGrades: readonly FormOption[]
  readonly harvestYears: readonly FormOption[]
  readonly bagTypes: readonly FormOption[]
}

async function activeOptions(tx: Tx, table: string): Promise<FormOption[]> {
  const rows = await rawRows(
    tx,
    sql`select id, name_en from public.${sql.raw(table)} where is_active order by name_en limit 200`,
  )
  return rows.map((row) => ({ id: col.text(row.id), name: col.text(row.name_en) }))
}

export async function deliveryRequestFormOptions(tx: Tx): Promise<DeliveryRequestFormOptions> {
  const [coffeeTypes, coffeeGrades, harvestYears, bagTypes] = await Promise.all([
    activeOptions(tx, 'coffee_type'),
    activeOptions(tx, 'coffee_grade'),
    activeOptions(tx, 'harvest_year'),
    activeOptions(tx, 'bag_type'),
  ])
  return { coffeeTypes, coffeeGrades, harvestYears, bagTypes }
}

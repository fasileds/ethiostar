import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { systemClock } from '@core/clock/clock'
import { formatDocumentNumber, resetYearFor } from '../domain/number-series'

/**
 * Gapless allocation.
 *
 * THE WHOLE DESIGN IS ONE STATEMENT:
 *
 *   UPDATE document_number_series SET next_value = next_value + 1 … RETURNING next_value - 1
 *
 * That single statement takes a row lock held until the CALLER'S transaction ends. Three
 * properties follow, and each is a requirement rather than a nicety:
 *
 *   CONTIGUOUS   a second allocator for the same series blocks until the first commits, so
 *                two concurrent goods receipts cannot both take GRN-2026-000045.
 *   NO GAPS      the increment is part of the caller's transaction. A rolled-back receipt
 *                gives its number back, unlike `nextval()`, which would not.
 *   NARROW       the lock is per (series, branch, year), so issuing a gate pass never waits
 *                behind a goods receipt.
 *
 * The cost is that a long transaction holding an allocation serialises that one series.
 * That is why numbers are allocated LATE in a use case, immediately before the write that
 * needs them, and never before an expensive read.
 */

export interface AllocatedNumber {
  readonly formatted: string
  readonly value: number
  readonly seriesCode: string
  readonly resetYear: number
}

/**
 * Take the next number in a series, creating the series row for a new year if needed.
 *
 * `branchId` of `null` means the single global series, which is what a one-site deployment
 * uses. The unique index is NULLS NOT DISTINCT so exactly one such row can exist.
 */
export interface AllocateOptions {
  readonly branchId?: string | null
  /** Attribution for the series row's audit columns. Never optional. */
  readonly actorId: string
  readonly now?: Date
}

/**
 * Create this year's series row if it does not exist yet.
 *
 * Doing it here rather than in a January migration means numbering never silently stops at
 * midnight on the 31st of December. `ON CONFLICT DO NOTHING` makes the race harmless: two
 * concurrent first-documents-of-the-year both attempt it, one wins, and both then allocate.
 */
async function ensureSeriesRow(
  tx: Tx,
  seriesCode: string,
  branchId: string | null,
  resetYear: number,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    insert into public.document_number_series (
      id, series_code, branch_id, reset_year, prefix, next_value, padding,
      description, is_active, created_by, created_at, updated_at
    ) values (
      ${uuidv7()}, ${seriesCode}, ${branchId}::uuid, ${resetYear}, ${seriesCode}, 1, 6,
      ${`Auto-created for ${seriesCode} ${resetYear}`}, true,
      ${actorId}::uuid, now(), now()
    )
    on conflict do nothing
  `)
}

export async function allocateDocumentNumber(
  tx: Tx,
  seriesCode: string,
  options: AllocateOptions,
): Promise<AllocatedNumber> {
  const branchId = options.branchId ?? null
  const resetYear = resetYearFor(options.now ?? systemClock.now())

  await ensureSeriesRow(tx, seriesCode, branchId, resetYear, options.actorId)

  const rows = await rawRows(
    tx,
    sql`
      update public.document_number_series
      set next_value = next_value + 1,
          updated_at = now(),
          updated_by = ${options.actorId}::uuid,
          version = version + 1
      where series_code = ${seriesCode}
        and branch_id is not distinct from ${branchId}::uuid
        and reset_year = ${resetYear}
        and is_active
      returning next_value - 1 as allocated, prefix, padding, reset_year
    `,
  )

  const row = rows[0]
  if (!row) {
    // Only reachable if the series was deactivated between the insert and the update.
    // Failing loudly is right: issuing an unnumbered document is not an option.
    throw new Error(
      `Document number series "${seriesCode}" (branch ${branchId ?? 'global'}, ${resetYear}) is not active.`,
    )
  }

  const value = col.int(row.allocated)

  return {
    formatted: formatDocumentNumber(
      col.text(row.prefix),
      col.int(row.reset_year),
      value,
      col.int(row.padding),
    ),
    value,
    seriesCode,
    resetYear,
  }
}

/** Series configuration for the administration console. */
export interface SeriesRow {
  readonly id: string
  readonly seriesCode: string
  readonly branchId: string | null
  readonly resetYear: number
  readonly prefix: string
  readonly nextValue: number
  readonly padding: number
  readonly isActive: boolean
}

export async function listNumberSeries(tx: Tx): Promise<SeriesRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, series_code, branch_id, reset_year, prefix, next_value, padding, is_active
      from public.document_number_series
      order by series_code, reset_year desc
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    seriesCode: col.text(row.series_code),
    branchId: col.textOrNull(row.branch_id),
    resetYear: col.int(row.reset_year),
    prefix: col.text(row.prefix),
    nextValue: col.int(row.next_value),
    padding: col.int(row.padding),
    isActive: col.bool(row.is_active),
  }))
}

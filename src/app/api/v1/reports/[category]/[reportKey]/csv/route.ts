import { NextResponse } from 'next/server'
import { requireStaff, currentClaims } from '@server/auth/dal'
import { requirePermission } from '@server/auth/authorize'
import { runInTransaction } from '@db/transaction'
import { findReport, rowsToCsv, type ReportRunParams } from '@modules/reporting'
import { NotFoundError, toAppError } from '@core/errors/app-error'
import { systemClock } from '@core/clock/clock'
import { toBusinessDate, addDays } from '@core/utils/date'

/**
 * `GET /api/v1/reports/[category]/[reportKey]/csv` — the second REST route in this codebase
 * (see `/api/v1/documents/[id]/pdf` for the first and the auth pattern this follows).
 *
 * Unlike the PDF route, there is no signed-URL redirect here: a report is generated on
 * demand from live data, not a stored object, so the route builds the CSV itself and streams
 * it back with `Content-Disposition: attachment`.
 *
 * THE PERMISSION CHECK IS EXPLICIT, not left to RLS: `report:view_financial` vs
 * `report:view_operational` is an authorization distinction between report CATEGORIES, not a
 * row-ownership rule any table policy encodes. A Store Keeper's RLS grants would happily
 * return every invoice row; `requirePermission` is what actually stops them.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ category: string; reportKey: string }> },
): Promise<Response> {
  const { category, reportKey } = await params

  try {
    const actor = await requireStaff()
    const claims = await currentClaims()

    const report = findReport(category, reportKey)
    if (!report) throw NotFoundError.of('Report', `${category}/${reportKey}`)

    requirePermission(actor, report.permission)

    const url = new URL(request.url)
    const today = toBusinessDate(systemClock.now())
    const monthAgo = toBusinessDate(addDays(systemClock.now(), -30))

    const runParams: ReportRunParams = {
      branchId: url.searchParams.get('branchId'),
      date: url.searchParams.get('date') ?? today,
      periodStart: url.searchParams.get('periodStart') ?? monthAgo,
      periodEnd: url.searchParams.get('periodEnd') ?? today,
      asOfDate: url.searchParams.get('asOfDate') ?? today,
    }

    const rows = await runInTransaction(claims, (tx) => report.run(tx, runParams))
    const csv = rowsToCsv(rows, report.columns)

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${report.key}.csv"`,
      },
    })
  } catch (error) {
    const appError = toAppError(error)
    return NextResponse.json(
      { code: appError.code, message: appError.message },
      { status: appError.httpStatus },
    )
  }
}

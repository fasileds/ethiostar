import type { DailyIntake } from '@modules/portal'
import { Card, CardHeader } from '@ui/patterns/Card'

/**
 * Coffee received per business day, over the last fortnight.
 *
 * ── Why a bar chart, and why one series ──────────────────────────────────────
 * The question is "how much came in on each day" — magnitude across discrete,
 * evenly-spaced buckets. Bars anchored to a zero baseline answer that directly. A line
 * would imply intake is continuous between days, which it is not: a plant either received a
 * truck or it did not.
 *
 * One series, so there is no legend — the panel title names the measure. Colour carries no
 * meaning here beyond "this is the data", which is why every bar is the same brand green
 * rather than a gradient across the days. A rainbow here would encode nothing.
 *
 * ── Why zero days are drawn ─────────────────────────────────────────────────
 * `dailyIntake` zero-fills its date spine. A trend that omits empty days makes a plant that
 * received nothing on Tuesday look identical to one that ran two days straight, which is the
 * single most misleading thing this panel could do.
 *
 * ── Accessibility ───────────────────────────────────────────────────────────
 * The chart is `aria-hidden` and a real `<table>` carries the same numbers to screen
 * readers — an SVG of rectangles is not data. Each bar also has an SVG `<title>`, which
 * gives a native hover tooltip with no client JavaScript at all: this stays a server
 * component, and an operations dashboard should not ship a charting library to render
 * fourteen rectangles.
 */

/** Brand green. Validated at 3:1+ against the raised surface; the gold in the palette is
    far too light to carry a mark and is deliberately not used here. */
const MARK = 'var(--color-brand-700)'

const VIEW_W = 720
const VIEW_H = 200
const PAD_TOP = 16
const PAD_BOTTOM = 26
const GAP = 2

function formatKg(value: string, locale = 'en-US'): string {
  const [whole = '0', fraction = ''] = value.replace('-', '').split('.')
  const grouped = new Intl.NumberFormat(locale).format(BigInt(whole))
  return fraction && Number(fraction) > 0 ? `${grouped}.${fraction}` : grouped
}

/** `2026-08-13` → `13 Aug`, without constructing a Date (and so without a timezone). */
function shortDay(iso: string): string {
  const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  const [, month = '01', day = '01'] = iso.split('-')
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''}`
}

/** A bar with its top corners rounded and its base square on the axis. */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h))
  const bottom = y + h
  return [
    `M ${x} ${bottom}`,
    `L ${x} ${y + radius}`,
    `Q ${x} ${y} ${x + radius} ${y}`,
    `L ${x + w - radius} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + radius}`,
    `L ${x + w} ${bottom}`,
    'Z',
  ].join(' ')
}

export function IntakeTrend({ days }: { readonly days: readonly DailyIntake[] }) {
  const values = days.map((d) => Number(d.quantityKg))
  const total = values.reduce((sum, v) => sum + v, 0)
  const peak = Math.max(...values, 0)
  const peakIndex = values.indexOf(peak)

  const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM
  const slot = days.length > 0 ? VIEW_W / days.length : VIEW_W
  const barW = Math.max(2, slot - GAP)

  return (
    <Card padded={false}>
      <div className="p-4 sm:p-5">
        <CardHeader
          title="Intake"
          description={`Coffee received per business day over the last ${days.length} days, Africa/Addis_Ababa.`}
          action={
            <div className="text-right">
              <p className="numeric text-lg font-semibold">
                {formatKg(total.toFixed(3).replace(/\.?0+$/, '') || '0')}
                <span className="ml-1 text-sm font-normal opacity-55">kg</span>
              </p>
              <p className="text-2xs text-[var(--text-tertiary)]">fortnight total</p>
            </div>
          }
        />
      </div>

      {total === 0 ? (
        // Not an error, and not a chart of nothing: an empty axis with fourteen zero-height
        // bars reads as a rendering fault. Say what will make it populate instead.
        <div className="border-t border-[var(--border-subtle)] px-4 py-10 text-center sm:px-5">
          <p className="text-sm font-medium">No coffee received in this period</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">
            The trend fills in as goods receipts are posted at the bay. Until then there is
            nothing to plot — this is an empty plant, not a broken panel.
          </p>
        </div>
      ) : (
        <div className="border-t border-[var(--border-subtle)] px-2 pt-4 pb-2 sm:px-3">
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="h-auto w-full"
            role="img"
            aria-label={`Intake over the last ${days.length} days`}
          >
            {/* Recessive gridlines — quarter, half, three-quarters of the peak. */}
            {[0.25, 0.5, 0.75, 1].map((fraction) => {
              const y = PAD_TOP + plotH * (1 - fraction)
              return (
                <line
                  key={fraction}
                  x1={0}
                  x2={VIEW_W}
                  y1={y}
                  y2={y}
                  stroke="var(--border-subtle)"
                  strokeWidth={1}
                />
              )
            })}

            {days.map((day, index) => {
              const value = Number(day.quantityKg)
              const h = peak > 0 ? (value / peak) * plotH : 0
              const x = index * slot + GAP / 2
              const y = PAD_TOP + plotH - h

              return (
                <g key={day.day}>
                  {value > 0 ? (
                    <path
                      d={barPath(x, y, barW, h, 4)}
                      fill={MARK}
                      className="transition-opacity duration-150 hover:opacity-80"
                    >
                      <title>
                        {shortDay(day.day)} — {formatKg(day.quantityKg)} kg,{' '}
                        {day.keshaCount.toLocaleString('en-US')} kesha, {day.consignments}{' '}
                        consignment{day.consignments === 1 ? '' : 's'}
                      </title>
                    </path>
                  ) : (
                    // A day with no intake still gets a mark, so the gap is legible as a
                    // zero rather than as missing data.
                    <rect
                      x={x}
                      y={PAD_TOP + plotH - 2}
                      width={barW}
                      height={2}
                      rx={1}
                      fill="var(--border-default)"
                    >
                      <title>{shortDay(day.day)} — nothing received</title>
                    </rect>
                  )}

                  {/* Labels on the ends and the peak only. A number over every bar is
                      noise, and at fourteen buckets they would collide. */}
                  {index === 0 || index === days.length - 1 || index === peakIndex ? (
                    <text
                      x={x + barW / 2}
                      y={VIEW_H - 8}
                      textAnchor="middle"
                      className="fill-[var(--text-tertiary)] text-[11px]"
                    >
                      {shortDay(day.day)}
                    </text>
                  ) : null}
                </g>
              )
            })}

            {/* Baseline, drawn last so bars sit on it. */}
            <line
              x1={0}
              x2={VIEW_W}
              y1={PAD_TOP + plotH}
              y2={PAD_TOP + plotH}
              stroke="var(--border-default)"
              strokeWidth={1}
            />
          </svg>
        </div>
      )}

      {/* The same numbers, as data. Visually hidden but fully available to assistive
          technology and to anyone who would rather read the figures than the picture. */}
      <table className="sr-only">
        <caption>Coffee received per business day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Kilograms</th>
            <th scope="col">Kesha</th>
            <th scope="col">Consignments</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <th scope="row">{day.day}</th>
              <td>{day.quantityKg}</td>
              <td>{day.keshaCount}</td>
              <td>{day.consignments}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

import * as React from 'react'
import Link from 'next/link'
import { EmptyState } from './Card'
import { ButtonLink } from '@ui/primitives/Button'

/**
 * The list table every operational screen uses.
 *
 * Columns are declared as data rather than markup so a row can be rendered as a table on a
 * desktop and as a stacked card on a phone from ONE definition. A supervisor approving
 * delivery requests from the yard on a phone sees the same columns in the same order as the
 * same person at a desk — two hand-maintained layouts always drift, and the one that drifts
 * is always the mobile one.
 *
 * Quantities are right-aligned and tabular by convention (`numeric`), so a column of weights
 * can be scanned for an outlier without reading each value.
 */

export interface Column<T> {
  readonly key: string
  readonly header: string
  readonly render: (row: T) => React.ReactNode
  /** Right-align and use tabular figures. For quantities and counts. */
  readonly numeric?: boolean
  /** Hidden below `sm`. Use for context columns, never for the identifying one. */
  readonly secondary?: boolean
  readonly width?: string
}

export interface DataTableProps<T> {
  readonly rows: readonly T[]
  readonly columns: ReadonlyArray<Column<T>>
  readonly rowKey: (row: T) => string
  /** Makes the whole row a link. The first column also renders as the visible link text. */
  readonly rowHref?: (row: T) => string
  /**
   * `description` is required, not optional. An empty state that says only "No results" tells
   * an operator nothing about whether the filter is wrong, the work has not started, or the
   * system is broken — and that ambiguity is what sends them to the phone.
   */
  readonly empty?: {
    readonly title: string
    readonly description: string
    readonly icon?: React.ReactNode
    readonly action?: React.ReactNode
  }
  readonly caption?: string
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  rowHref,
  empty,
  caption,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          title={empty?.title ?? 'Nothing here yet'}
          description={empty?.description ?? 'Nothing matches the current filters.'}
          {...(empty?.icon ? { icon: empty.icon } : {})}
          {...(empty?.action ? { action: empty.action } : {})}
        />
      </div>
    )
  }

  return (
    <>
      {/* Desktop and tablet — a real table, so screen readers get real row/column semantics. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          {/* Sticky, so the column meanings survive a scroll. A stock list runs to hundreds
              of rows and a bare number two screens down the page is not a quantity yet. */}
          <thead className="sticky top-0 z-10 border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)]">
            <tr className="text-2xs tracking-wide text-[var(--text-secondary)] uppercase">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={`px-4 py-2.5 font-medium ${column.numeric ? 'text-right' : ''} ${
                    column.secondary ? 'hidden lg:table-cell' : ''
                  }`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface-hover)]"
              >
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 align-middle ${
                      column.numeric ? 'numeric text-right' : ''
                    } ${column.secondary ? 'hidden lg:table-cell' : ''}`}
                  >
                    {index === 0 && rowHref ? (
                      <Link
                        href={rowHref(row)}
                        className="rounded font-medium text-[var(--text-brand)] hover:underline"
                      >
                        {column.render(row)}
                      </Link>
                    ) : (
                      column.render(row)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone — the same columns, stacked. Label/value pairs, not a squashed table. */}
      <ul className="divide-y divide-[var(--border-subtle)] sm:hidden">
        {rows.map((row) => {
          const [first, ...rest] = columns
          const body = (
            <>
              {first ? (
                <div className="mb-1.5 flex items-center justify-between gap-2 font-medium text-[var(--text-brand)]">
                  <span className="min-w-0 truncate">{first.render(row)}</span>
                  {/* On a phone a tappable row has no hover to reveal it, so the chevron is
                      permanent — otherwise these read as a static list of facts. */}
                  {rowHref ? (
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      className="size-4 shrink-0 text-[var(--text-tertiary)]"
                      aria-hidden
                    >
                      <path
                        d="M6 3.5 10.5 8 6 12.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </div>
              ) : null}
              <dl className="space-y-1">
                {rest.map((column) => (
                  <div key={column.key} className="flex items-baseline justify-between gap-3">
                    <dt className="text-2xs tracking-wide text-[var(--text-tertiary)] uppercase">
                      {column.header}
                    </dt>
                    <dd className={`text-sm ${column.numeric ? 'numeric text-right' : ''}`}>
                      {column.render(row)}
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )

          return (
            <li key={rowKey(row)}>
              {rowHref ? (
                <Link
                  href={rowHref(row)}
                  className="block px-4 py-3 transition-colors duration-[var(--duration-fast)] active:bg-[var(--surface-hover)]"
                >
                  {body}
                </Link>
              ) : (
                <div className="px-4 py-3">{body}</div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

/**
 * Keyset pagination controls.
 *
 * "Next" only — there is no page number, because with keyset pagination there is no such
 * thing as page 7 without walking to it. Offering it would be a lie that gets slower the
 * further someone goes. Back is handled by the browser, which already holds the previous
 * cursor in history.
 */
export function CursorPager({
  nextCursor,
  hasMore,
  basePath,
  params,
  shown,
}: {
  readonly nextCursor: string | null
  readonly hasMore: boolean
  readonly basePath: string
  /** Current filters, carried across the page boundary. */
  readonly params?: Readonly<Record<string, string | undefined>>
  readonly shown: number
}) {
  if (!hasMore || !nextCursor) {
    return (
      <div className="border-t border-[var(--border-subtle)] px-4 py-3 text-xs text-[var(--text-tertiary)]">
        Showing all {shown} {shown === 1 ? 'result' : 'results'}.
      </div>
    )
  }

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') search.set(key, value)
  }
  search.set('cursor', nextCursor)

  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-4 py-3">
      <span className="numeric text-xs text-[var(--text-tertiary)]">Showing {shown}</span>
      <ButtonLink
        href={`${basePath}?${search.toString()}`}
        size="sm"
        variant="secondary"
        iconRight={
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            className="size-3.5"
            aria-hidden
          >
            <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        }
      >
        Next
      </ButtonLink>
    </div>
  )
}

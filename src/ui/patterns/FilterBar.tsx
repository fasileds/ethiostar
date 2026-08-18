import * as React from 'react'
import Link from 'next/link'

/**
 * List filters, as links rather than a client-side form.
 *
 * A filter is a URL. That makes a filtered view shareable ("look at the blocked dispatches"),
 * bookmarkable, and survivable across a refresh — and it keeps these screens as server
 * components with no client JavaScript at all.
 */

export interface FilterOption {
  readonly value: string
  readonly label: string
  readonly count?: number | undefined
}

export function FilterTabs({
  options,
  active,
  basePath,
  paramName = 'status',
  params,
}: {
  readonly options: readonly FilterOption[]
  readonly active: string | undefined
  readonly basePath: string
  readonly paramName?: string
  /** Other active filters, preserved when switching tab. */
  readonly params?: Readonly<Record<string, string | undefined>>
}) {
  const href = (value: string) => {
    const search = new URLSearchParams()
    for (const [key, entry] of Object.entries(params ?? {})) {
      if (key !== paramName && key !== 'cursor' && entry) search.set(key, entry)
    }
    // Switching a filter resets the cursor: page 2 of the old filter is meaningless.
    if (value) search.set(paramName, value)
    const query = search.toString()
    return query ? `${basePath}?${query}` : basePath
  }

  return (
    <div
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
      role="group"
      aria-label="Filter by status"
    >
      {options.map((option) => {
        const isActive = (active ?? '') === option.value
        return (
          <Link
            key={option.value || 'all'}
            href={href(option.value)}
            aria-current={isActive ? 'true' : undefined}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-[color,background-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)] ${
              isActive
                ? 'bg-brand-700 font-medium text-white shadow-xs'
                : 'text-[var(--text-secondary)] ring-1 ring-inset ring-[var(--border-default)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] hover:ring-[var(--border-strong)]'
            }`}
          >
            {option.label}
            {option.count !== undefined && option.count > 0 ? (
              <span
                className={`numeric rounded-full px-1.5 text-2xs font-semibold ${
                  isActive ? 'bg-white/20' : 'bg-[var(--surface-sunken)]'
                }`}
              >
                {option.count}
              </span>
            ) : null}
          </Link>
        )
      })}
    </div>
  )
}

/**
 * Free-text search.
 *
 * A plain GET form — no client component, no debounce, no fetch. The result is a URL, which
 * is the same property the tabs have.
 */
export function SearchForm({
  action,
  defaultValue,
  placeholder = 'Search…',
  hidden,
}: {
  readonly action: string
  readonly defaultValue?: string | undefined
  readonly placeholder?: string
  /** Other filters to carry through the submit. */
  readonly hidden?: Readonly<Record<string, string | undefined>>
}) {
  return (
    <form action={action} method="get" role="search" className="relative w-full sm:max-w-xs">
      {Object.entries(hidden ?? {})
        .filter(([key, value]) => value && key !== 'q' && key !== 'cursor')
        .map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}

      <label htmlFor="list-search" className="sr-only">
        Search
      </label>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-tertiary)]"
        aria-hidden
      >
        <circle cx="9" cy="9" r="5.5" />
        <path d="m13.5 13.5 3 3" strokeLinecap="round" />
      </svg>
      <input
        id="list-search"
        type="search"
        name="q"
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-9 w-full rounded-md bg-[var(--surface-raised)] pr-3 pl-9 text-base ring-1 ring-inset ring-[var(--border-default)] transition-[box-shadow] duration-[var(--duration-fast)] placeholder:text-[var(--text-tertiary)] hover:ring-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)] focus:outline-none"
      />
    </form>
  )
}

/** A toolbar row: filters on the left, search and actions on the right. */
export function ListToolbar({
  children,
  trailing,
}: {
  readonly children: React.ReactNode
  readonly trailing?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-4">
      <div className="min-w-0 flex-1">{children}</div>
      {trailing ? <div className="flex shrink-0 items-center gap-2">{trailing}</div> : null}
    </div>
  )
}

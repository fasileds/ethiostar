import * as React from 'react'
import Link from 'next/link'

/**
 * Surfaces and page furniture.
 *
 * Deliberately low-contrast and low-elevation. An operational system is read for hours at a
 * time; heavy cards and strong shadows make a dense screen tiring and make genuinely urgent
 * things harder to spot, because everything already shouts.
 *
 * Elevation is therefore a SIGNAL, not decoration: a flat card is inert, and the only things
 * that lift on hover are the things you can click.
 */

export function Card({
  children,
  className = '',
  padded = true,
  as: Component = 'div',
}: {
  readonly children: React.ReactNode
  readonly className?: string
  readonly padded?: boolean
  readonly as?: React.ElementType
}) {
  return (
    <Component
      className={`rounded-lg bg-[var(--surface-raised)] shadow-xs ring-1 ring-[var(--border-subtle)] ${padded ? 'p-4 sm:p-5' : ''} ${className}`}
    >
      {children}
    </Component>
  )
}

export function CardHeader({
  title,
  description,
  action,
  className = '',
}: {
  readonly title: React.ReactNode
  readonly description?: React.ReactNode
  readonly action?: React.ReactNode
  readonly className?: string
}) {
  return (
    <div className={`flex items-start justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold">{title}</h3>
        {description ? (
          <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/**
 * A headline figure.
 *
 * `intent` drives a left accent rail rather than tinting the whole card: the number stays
 * the most legible thing on screen, which is the point of a stat tile.
 */
export function StatCard({
  label,
  value,
  secondary,
  hint,
  intent = 'neutral',
  href,
  icon,
}: {
  readonly label: string
  readonly value: React.ReactNode
  readonly secondary?: React.ReactNode
  readonly hint?: string
  readonly intent?: 'neutral' | 'brand' | 'warn' | 'danger' | 'success'
  readonly href?: string
  readonly icon?: React.ReactNode
}) {
  const rail = {
    neutral: 'before:bg-neutral-300 dark:before:bg-neutral-700',
    brand: 'before:bg-brand-600',
    warn: 'before:bg-warning-500',
    danger: 'before:bg-danger-500',
    success: 'before:bg-success-500',
  }[intent]

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-[var(--text-secondary)] uppercase">
          {label}
        </p>
        {icon ? <span className="shrink-0 text-[var(--text-tertiary)]">{icon}</span> : null}
      </div>
      <div className="mt-2.5">{value}</div>
      {secondary ? <div className="mt-1">{secondary}</div> : null}
      {hint ? <p className="mt-2 text-xs text-[var(--text-tertiary)]">{hint}</p> : null}
    </>
  )

  const shell = `relative overflow-hidden rounded-lg bg-[var(--surface-raised)] p-4 pl-5 shadow-xs ring-1 ring-[var(--border-subtle)] before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-[''] ${rail}`

  if (href) {
    return (
      // `Link`, not `<a>`: a bare anchor here reloads the whole document, which on a
      // dashboard means re-running every panel query to land on a page that was one
      // client-side transition away.
      <Link
        href={href}
        className={`${shell} interactive-surface group block hover:ring-[var(--border-default)]`}
      >
        {body}
        {/* A quiet affordance, so a tile you can open is distinguishable from one you
            cannot without hovering to find out. */}
        <span
          className="absolute right-3 bottom-3 text-[var(--text-tertiary)] opacity-0 transition-opacity duration-[var(--duration-base)] group-hover:opacity-100"
          aria-hidden
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            className="size-3.5"
          >
            <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </Link>
    )
  }

  return <div className={shell}>{body}</div>
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  meta,
}: {
  readonly title: React.ReactNode
  readonly description?: React.ReactNode
  readonly actions?: React.ReactNode
  readonly breadcrumb?: React.ReactNode
  readonly meta?: React.ReactNode
}) {
  return (
    <header className="border-b border-[var(--border-subtle)] pb-5">
      {breadcrumb ? <div className="mb-2">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">{description}</p>
          ) : null}
          {meta ? <div className="mt-3">{meta}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}

/**
 * Empty state.
 *
 * Always says what to DO, not just that there is nothing. "No consignments yet" is a dead
 * end; "No consignments yet — approve a delivery request to create one" is a next step.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  readonly title: string
  readonly description: string
  readonly action?: React.ReactNode
  readonly icon?: React.ReactNode
}) {
  return (
    <div className="texture-weave flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border-default)] px-6 py-14 text-center">
      {icon ? (
        // The icon sits in a ring rather than floating loose, which stops a 32px glyph
        // reading as a rendering failure in the middle of an otherwise empty panel.
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-tertiary)] ring-1 ring-[var(--border-subtle)]">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-[var(--text-secondary)]">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Loading
   ═══════════════════════════════════════════════════════════════════════════
   These mirror the SHAPE of the screen they stand in for — a stat row stays a stat row, a
   table stays a table. A centred spinner tells someone the page is busy; a skeleton tells
   them what is arriving, so the layout does not jump when it does.

   Everything here is `aria-hidden` under a single labelled live region: a screen reader
   should hear "loading" once, not read out forty empty grey boxes. */

export function Skeleton({
  className = '',
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { readonly className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden {...rest} />
}

/** Wraps a skeleton screen so assistive technology announces it once, and politely. */
export function LoadingRegion({
  label = 'Loading',
  children,
}: {
  readonly label?: string
  readonly children: React.ReactNode
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

export function PageHeaderSkeleton() {
  return (
    <div className="border-b border-[var(--border-subtle)] pb-5">
      <Skeleton className="h-7 w-56 rounded-md" />
      <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-lg bg-[var(--surface-raised)] p-4 pl-5 shadow-xs ring-1 ring-[var(--border-subtle)]">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-8 w-32 rounded-md" />
      <Skeleton className="mt-2 h-3 w-20" />
    </div>
  )
}

export function StatRowSkeleton({ count = 3 }: { readonly count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <StatCardSkeleton key={index} />
      ))}
    </div>
  )
}

/** Stands in for a DataTable. `columns` keeps the column rhythm believable. */
export function TableSkeleton({
  rows = 6,
  columns = 4,
}: {
  readonly rows?: number
  readonly columns?: number
}) {
  return (
    <div className="overflow-hidden rounded-lg bg-[var(--surface-raised)] shadow-xs ring-1 ring-[var(--border-subtle)]">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-3">
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: columns }, (_, column) => (
              <Skeleton
                key={column}
                // The first column is the identifying one and is always wider; the rest
                // alternate so the block does not read as a printed grid.
                className={`h-4 ${column === 0 ? 'w-32' : column % 2 === 0 ? 'w-20' : 'w-16'} ${
                  column > 1 ? 'hidden lg:block' : ''
                }`}
              />
            ))}
            <div className="flex-1" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function CardSkeleton({ lines = 3 }: { readonly lines?: number }) {
  return (
    <div className="rounded-lg bg-[var(--surface-raised)] p-4 shadow-xs ring-1 ring-[var(--border-subtle)] sm:p-5">
      <Skeleton className="h-5 w-40 rounded-md" />
      <Skeleton className="mt-2 h-3 w-56 max-w-full" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} className="h-4" style={{ width: `${92 - index * 14}%` }} />
        ))}
      </div>
    </div>
  )
}

/** Section divider with an optional label, for long detail pages. */
export function SectionDivider({ label }: { readonly label?: string }) {
  if (!label) return <hr className="my-6 border-[var(--border-subtle)]" />

  return (
    <div className="my-6 flex items-center gap-3">
      <span className="text-xs font-medium tracking-wide text-[var(--text-tertiary)] uppercase">
        {label}
      </span>
      <hr className="flex-1 border-[var(--border-subtle)]" />
    </div>
  )
}

/** Key/value row, for detail panels. */
export function Field({
  label,
  children,
  className = '',
}: {
  readonly label: string
  readonly children: React.ReactNode
  readonly className?: string
}) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <dt className="text-xs font-medium text-[var(--text-secondary)]">{label}</dt>
      <dd className="text-base">{children}</dd>
    </div>
  )
}

export function FieldGrid({
  children,
  columns = 3,
}: {
  readonly children: React.ReactNode
  readonly columns?: 2 | 3 | 4
}) {
  const cols = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 lg:grid-cols-4',
  }[columns]
  return <dl className={`grid grid-cols-1 gap-x-6 gap-y-4 ${cols}`}>{children}</dl>
}

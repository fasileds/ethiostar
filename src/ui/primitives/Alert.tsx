import * as React from 'react'

/**
 * A page-level message.
 *
 * Lives beside the form controls rather than inside `Field.tsx`, because an alert is not a
 * field: it is used on its own for readiness notices and submit failures on screens that
 * have no form at all.
 */

const ALERT_TONE = {
  danger:
    'bg-danger-50 text-danger-900 ring-danger-100 dark:bg-danger-900/20 dark:text-danger-100 dark:ring-danger-900',
  warning:
    'bg-warning-50 text-warning-900 ring-warning-100 dark:bg-warning-900/20 dark:text-warning-100 dark:ring-warning-900',
  success:
    'bg-success-50 text-success-900 ring-success-100 dark:bg-success-900/20 dark:text-success-100 dark:ring-success-900',
  info: 'bg-info-50 text-info-900 ring-info-100 dark:bg-info-900/20 dark:text-info-100 dark:ring-info-900',
} as const

export type AlertTone = keyof typeof ALERT_TONE

/**
 * A page-level message.
 *
 * Carries an ICON as well as a tint, for the same reason every badge carries a label: these
 * screens are printed (M06) and are read by people for whom red and green are the same
 * colour. The shape is the signal that survives both.
 */
export function Alert({
  tone = 'danger',
  title,
  children,
}: {
  readonly tone?: AlertTone
  readonly title?: string
  readonly children: React.ReactNode
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`flex gap-2.5 rounded-md px-3.5 py-3 text-sm ring-1 ring-inset ${ALERT_TONE[tone]}`}
    >
      <span className="mt-px shrink-0" aria-hidden>
        <AlertIcon tone={tone} />
      </span>
      <div className="min-w-0 flex-1">
        {title ? <p className="mb-0.5 font-semibold">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  )
}

function AlertIcon({ tone }: { readonly tone: AlertTone }) {
  if (tone === 'success') {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" className="size-4">
        <path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm3.03 4.22a.75.75 0 0 0-1.06 0L7.25 8.44 6.03 7.22a.75.75 0 1 0-1.06 1.06l1.75 1.75a.75.75 0 0 0 1.06 0l3.25-3.25a.75.75 0 0 0 0-1.06Z" />
      </svg>
    )
  }

  if (tone === 'warning') {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" className="size-4">
        <path d="M8 1.5a.9.9 0 0 1 .78.45l6 10.5A.9.9 0 0 1 14 13.8H2a.9.9 0 0 1-.78-1.35l6-10.5A.9.9 0 0 1 8 1.5Zm0 3.4a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 8 4.9Zm0 6.85a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
      </svg>
    )
  }

  if (tone === 'info') {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" className="size-4">
        <path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm0 5.25a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 6.75Zm0-2.65a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className="size-4">
      <path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13ZM8 4a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 4Zm0 7.75a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
    </svg>
  )
}

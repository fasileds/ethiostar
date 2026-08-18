'use client'

import * as React from 'react'

/**
 * Internal scaffolding shared by every control in `Field.tsx`.
 *
 * Not exported from the design system's public surface — callers use `Input`, `Select`,
 * `Textarea` and `Checkbox`. This file exists so those four cannot drift: three controls
 * that each grew their own error markup is exactly how a form ends up with three different
 * red texts at three different sizes, and how one of them quietly loses its
 * `aria-describedby`.
 */

/**
 * The ring/background recipe every control shares. Size and alignment come in through
 * `className` from the caller, because they are the only things that genuinely differ.
 */
export function controlClass({
  error,
  className = '',
}: {
  readonly error?: string | undefined
  readonly className?: string
}): string {
  return [
    'w-full rounded-md bg-[var(--surface-raised)] text-[var(--text-primary)]',
    'ring-1 ring-inset transition-[box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
    'placeholder:text-[var(--text-tertiary)]',
    'disabled:cursor-not-allowed disabled:bg-[var(--surface-sunken)] disabled:text-[var(--text-tertiary)]',
    'focus:ring-2 focus:outline-none',
    error
      ? 'ring-danger-500 focus:ring-danger-500'
      : 'ring-[var(--border-default)] hover:ring-[var(--border-strong)] focus:ring-[var(--focus-ring)]',
    className,
  ]
    .filter(Boolean)
    .join(' ')
}

export function FieldLabel({
  htmlFor,
  children,
  required,
  touch,
}: {
  readonly htmlFor: string
  readonly children: React.ReactNode
  readonly required?: boolean | undefined
  readonly touch?: boolean
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={`mb-1.5 block font-medium text-[var(--text-primary)] ${touch ? 'text-base' : 'text-sm'}`}
    >
      {children}
      {required ? (
        <span className="ml-1 text-danger-700 dark:text-danger-100" aria-hidden>
          *
        </span>
      ) : null}
    </label>
  )
}

/**
 * Hint and error, below the control.
 *
 * The error REPLACES the hint rather than stacking under it. Two lines of small grey and red
 * text under a field is where people stop reading either.
 */
export function FieldMessages({
  error,
  hint,
  errorId,
  hintId,
}: {
  readonly error?: string | undefined
  readonly hint?: React.ReactNode
  readonly errorId: string
  readonly hintId: string
}) {
  if (error) {
    return (
      <p
        id={errorId}
        role="alert"
        className="mt-1.5 flex items-start gap-1.5 text-xs text-danger-700 dark:text-danger-100"
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className="mt-px size-3.5 shrink-0"
          aria-hidden
        >
          <path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13ZM8 4a.75.75 0 0 0-.75.75v3.5a.75.75 0 0 0 1.5 0v-3.5A.75.75 0 0 0 8 4Zm0 7.75a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
        </svg>
        {error}
      </p>
    )
  }

  if (hint) {
    return (
      <p id={hintId} className="mt-1.5 text-xs text-[var(--text-tertiary)]">
        {hint}
      </p>
    )
  }

  return null
}

/** Wires the ids together so every control describes itself the same way. */
export function useFieldIds(id: string | undefined) {
  const generated = React.useId()
  const fieldId = id ?? generated
  return {
    fieldId,
    errorId: `${fieldId}-error`,
    hintId: `${fieldId}-hint`,
  }
}

export function describedBy({
  error,
  hint,
  errorId,
  hintId,
}: {
  readonly error?: string | undefined
  readonly hint?: React.ReactNode
  readonly errorId: string
  readonly hintId: string
}): string | undefined {
  const ids = [error ? errorId : null, !error && hint ? hintId : null].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
}

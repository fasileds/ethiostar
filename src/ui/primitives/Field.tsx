'use client'

import * as React from 'react'
import {
  controlClass,
  describedBy,
  FieldLabel,
  FieldMessages,
  useFieldIds,
} from './field-parts'

/**
 * Form controls.
 *
 * Every input is labelled, every error is tied to its field by `aria-describedby`, and
 * errors render as text rather than colour alone. This is not compliance box-ticking: the
 * receiving screen is operated at speed by someone who cannot afford to guess which field
 * a red border refers to.
 *
 * The label / hint / error scaffolding all four controls share lives in `./field-parts`.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   Input
   ═══════════════════════════════════════════════════════════════════════════ */

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  readonly label: string
  readonly error?: string | undefined
  readonly hint?: string | undefined
  /** Suffix shown inside the field — "kg", "kesha". */
  readonly unit?: string
  /** Bigger control for the bay and the gate. */
  readonly touch?: boolean
  /** Tabular figures and right alignment for quantities. */
  readonly numeric?: boolean
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, unit, touch = false, numeric = false, className = '', id, ...rest },
  ref,
) {
  const { fieldId, errorId, hintId } = useFieldIds(id)

  return (
    <div className={className}>
      <FieldLabel htmlFor={fieldId} required={rest.required} touch={touch}>
        {label}
      </FieldLabel>

      <div className="relative">
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy({ error, hint, errorId, hintId })}
          className={controlClass({
            error,
            className: [
              touch ? 'h-[var(--size-touch-lg)] px-4 text-xl' : 'h-9 px-3 text-base',
              numeric ? 'numeric text-right font-semibold' : '',
              unit ? 'pr-12' : '',
            ]
              .filter(Boolean)
              .join(' '),
          })}
          {...rest}
        />
        {unit ? (
          <span
            className={`pointer-events-none absolute inset-y-0 right-3 flex items-center text-[var(--text-tertiary)] ${touch ? 'text-base' : 'text-sm'}`}
          >
            {unit}
          </span>
        ) : null}
      </div>

      <FieldMessages error={error} hint={hint} errorId={errorId} hintId={hintId} />
    </div>
  )
})

/* ═══════════════════════════════════════════════════════════════════════════
   Select
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  readonly label: string
  readonly error?: string | undefined
  readonly hint?: string | undefined
  readonly touch?: boolean
  readonly options: ReadonlyArray<{ value: string; label: string }>
  readonly placeholder?: string
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, hint, touch = false, options, placeholder, className = '', id, ...rest },
  ref,
) {
  const { fieldId, errorId, hintId } = useFieldIds(id)

  return (
    <div className={className}>
      <FieldLabel htmlFor={fieldId} required={rest.required} touch={touch}>
        {label}
      </FieldLabel>

      <div className="relative">
        <select
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy({ error, hint, errorId, hintId })}
          // The native arrow is drawn by the OS and differs on every platform, which is the
          // one control that makes a form look assembled rather than designed. Suppressed and
          // replaced with the chevron below.
          className={controlClass({
            error,
            className: `appearance-none ${touch ? 'h-[var(--size-touch-lg)] pr-11 pl-4 text-lg' : 'h-9 pr-9 pl-3 text-base'}`,
          })}
          {...rest}
        >
          {placeholder ? <option value="">{placeholder}</option> : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] ${touch ? 'right-4 size-5' : 'right-3 size-4'}`}
          aria-hidden
        >
          <path d="m6 8 4 4 4-4" />
        </svg>
      </div>

      <FieldMessages error={error} hint={hint} errorId={errorId} hintId={hintId} />
    </div>
  )
})

/* ═══════════════════════════════════════════════════════════════════════════
   Textarea
   ═══════════════════════════════════════════════════════════════════════════ */

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  readonly label: string
  readonly error?: string | undefined
  readonly hint?: string | undefined
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, className = '', id, rows = 4, ...rest },
  ref,
) {
  const { fieldId, errorId, hintId } = useFieldIds(id)

  return (
    <div className={className}>
      <FieldLabel htmlFor={fieldId} required={rest.required}>
        {label}
      </FieldLabel>

      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy({ error, hint, errorId, hintId })}
        // Vertical only. A horizontally resizable textarea inside a grid column drags the
        // layout apart, and nobody has ever wanted a wider one.
        className={controlClass({ error, className: 'resize-y px-3 py-2 text-base' })}
        {...rest}
      />

      <FieldMessages error={error} hint={hint} errorId={errorId} hintId={hintId} />
    </div>
  )
})

/* ═══════════════════════════════════════════════════════════════════════════
   Checkbox
   ═══════════════════════════════════════════════════════════════════════════ */

export interface CheckboxProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type'
> {
  readonly label: React.ReactNode
  readonly hint?: string | undefined
  readonly error?: string | undefined
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, error, className = '', id, ...rest },
  ref,
) {
  const { fieldId, errorId, hintId } = useFieldIds(id)

  return (
    <div className={className}>
      {/* The whole label is the hit target, not just the 16px box. */}
      <label htmlFor={fieldId} className="flex cursor-pointer items-start gap-2.5">
        <input
          ref={ref}
          id={fieldId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy({ error, hint, errorId, hintId })}
          className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-[var(--radius-xs)] border-[var(--border-strong)] text-brand-700 accent-brand-700 disabled:cursor-not-allowed"
          {...rest}
        />
        <span className="text-sm text-[var(--text-primary)]">{label}</span>
      </label>

      <div className="pl-[1.625rem]">
        <FieldMessages error={error} hint={hint} errorId={errorId} hintId={hintId} />
      </div>
    </div>
  )
})

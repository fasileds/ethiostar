import * as React from 'react'
import Link from 'next/link'

/**
 * Button, and its link twin.
 *
 * `size="touch"` exists because the receiving bay and gate screens are used one-handed on a
 * cheap tablet, sometimes in gloves, in bright sunlight. Those screens use it exclusively —
 * a 32px control that works fine on a desk is a mis-tap at the unloading bay.
 *
 * The recipe is exported and shared with `ButtonLink` rather than duplicated. That matters
 * more than it sounds: half the actions in this application NAVIGATE ("Check status", "Go to
 * sign in", "Request a delivery"), and before this existed every one of them was a hand-rolled
 * anchor with its own height, its own hover state and usually no focus treatment at all. A
 * button and a link that do the same job must look identical.
 */

export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
export type Size = 'sm' | 'md' | 'lg' | 'touch'

const VARIANT: Readonly<Record<Variant, string>> = {
  primary:
    'bg-brand-700 text-white shadow-xs hover:bg-brand-800 hover:shadow-sm active:bg-brand-900 active:shadow-xs disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none dark:disabled:bg-neutral-800 dark:disabled:text-neutral-600',
  secondary:
    'bg-[var(--surface-raised)] text-[var(--text-primary)] ring-1 ring-inset ring-[var(--border-default)] shadow-xs hover:bg-[var(--surface-hover)] hover:ring-[var(--border-strong)] active:bg-[var(--surface-sunken)] disabled:text-[var(--text-tertiary)] disabled:shadow-none',
  ghost:
    'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] active:bg-[var(--surface-sunken)] disabled:text-[var(--text-tertiary)]',
  danger:
    'bg-danger-700 text-white shadow-xs hover:bg-danger-500 hover:shadow-sm active:brightness-90 disabled:bg-neutral-300 disabled:text-neutral-500 disabled:shadow-none',
  subtle:
    'bg-brand-50 text-brand-800 hover:bg-brand-100 active:bg-brand-200 dark:bg-brand-900/40 dark:text-brand-200 dark:hover:bg-brand-900/60',
}

const SIZE: Readonly<Record<Size, string>> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-base gap-2 rounded-md',
  lg: 'h-11 px-5 text-lg gap-2 rounded-lg',
  touch: 'h-[var(--size-touch-lg)] px-6 text-lg gap-2.5 rounded-lg font-semibold',
}

/**
 * The shared class recipe.
 *
 * Transitions cover colour, shadow and ring rather than `transition-colors` alone, so the
 * elevation change on hover eases in with the tint instead of snapping a frame ahead of it.
 */
export function buttonClass({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className = '',
}: {
  readonly variant?: Variant
  readonly size?: Size
  readonly fullWidth?: boolean
  readonly className?: string
} = {}): string {
  return [
    'inline-flex items-center justify-center font-medium select-none',
    // Rings are box-shadows in Tailwind v4, so shadow and ring colour both ease on this one
    // property — `transition-colors` alone would snap the elevation a frame ahead of the tint.
    'transition-[color,background-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)]',
    'disabled:cursor-not-allowed aria-disabled:pointer-events-none aria-disabled:opacity-55',
    VARIANT[variant],
    SIZE[size],
    fullWidth ? 'w-full' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant
  readonly size?: Size
  readonly loading?: boolean
  readonly iconLeft?: React.ReactNode
  readonly iconRight?: React.ReactNode
  readonly fullWidth?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    iconLeft,
    iconRight,
    fullWidth = false,
    className = '',
    children,
    disabled,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      // A loading button stays focusable but is not activatable, so a screen reader user
      // is not silently ejected from the control mid-submit.
      aria-busy={loading || undefined}
      disabled={disabled ?? loading}
      className={buttonClass({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <Spinner /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  )
})

export interface ButtonLinkProps extends Omit<
  React.ComponentPropsWithoutRef<typeof Link>,
  'className'
> {
  readonly variant?: Variant
  readonly size?: Size
  readonly iconLeft?: React.ReactNode
  readonly iconRight?: React.ReactNode
  readonly fullWidth?: boolean
  readonly className?: string
  /**
   * Renders as a non-navigating control. An anchor cannot be `disabled`, so this uses
   * `aria-disabled` and drops the href — leaving the href and only greying it out produces a
   * link that still works for anyone using a keyboard or the context menu.
   */
  readonly disabled?: boolean
}

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  iconLeft,
  iconRight,
  fullWidth = false,
  className = '',
  disabled = false,
  children,
  href,
  ...rest
}: ButtonLinkProps) {
  const classes = buttonClass({ variant, size, fullWidth, className })

  if (disabled) {
    return (
      <span role="link" aria-disabled className={classes}>
        {iconLeft}
        {children}
        {iconRight}
      </span>
    )
  }

  return (
    <Link href={href} className={classes} {...rest}>
      {iconLeft}
      {children}
      {iconRight}
    </Link>
  )
}

function Spinner() {
  return (
    <svg className="size-4 shrink-0 animate-spin" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6.5"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
        fill="none"
      />
      <path
        d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

/** Square icon-only button. `label` is required — an unlabelled icon is not a control. */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, 'iconLeft' | 'iconRight' | 'fullWidth'> & { readonly label: string }
>(function IconButton(
  { variant = 'ghost', size = 'md', label, className = '', children, ...rest },
  ref,
) {
  const square = {
    sm: 'size-7',
    md: 'size-9',
    lg: 'size-11',
    touch: 'size-[var(--size-touch-lg)]',
  }[size]

  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-md transition-[color,background-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-out)] ${VARIANT[variant]} ${square} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
})

import { Badge } from '../primitives/Badge'
import { SearchIcon } from './Icon'

/**
 * The application top bar.
 *
 * A server component: it renders identity and context, none of which is interactive. The
 * only client piece is the user menu, which is passed in as a slot.
 *
 * The environment chip is not decoration. Staging is a full copy of production with
 * anonymised data, and someone WILL eventually approve a real-looking delivery request on
 * the wrong one. A permanent, unmissable marker is cheap insurance.
 */

export interface TopBarProps {
  readonly title?: string
  readonly actor: {
    readonly fullName: string
    readonly email: string
    readonly roleLabel: string
  }
  /** 'production' renders nothing — only non-production environments are marked. */
  readonly environment?: 'development' | 'staging' | 'production'
  readonly userMenu?: React.ReactNode
  readonly localeSwitcher?: React.ReactNode
}

export function TopBar({
  title,
  actor,
  environment = 'production',
  userMenu,
  localeSwitcher,
}: TopBarProps) {
  return (
    <header
      data-app-topbar
      className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]/85 px-4 backdrop-blur-md sm:px-6"
    >
      {/* Space for the mobile nav trigger, which is fixed at top-left. Matches the trigger's
          own size — see SideNav — so the title starts one gap after it, not adrift. */}
      <div className="w-9 shrink-0 lg:hidden" aria-hidden />

      {title ? (
        <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
      ) : null}

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {environment !== 'production' ? (
          <Badge tone={environment === 'staging' ? 'warning' : 'active'} size="sm">
            {environment === 'staging' ? 'STAGING' : 'DEV'}
          </Badge>
        ) : null}

        {localeSwitcher}

        <div className="hidden items-center gap-2.5 border-l border-[var(--border-subtle)] pl-3 sm:flex">
          <div className="text-right leading-tight">
            <p className="text-sm font-medium">{actor.fullName}</p>
            <p className="text-2xs text-[var(--text-tertiary)]">{actor.roleLabel}</p>
          </div>
          <Avatar name={actor.fullName} />
        </div>

        {userMenu}
      </div>
    </header>
  )
}

/**
 * Initials avatar.
 *
 * No uploaded photos in Phase 1 — that is a whole file-storage and moderation surface for
 * no operational benefit. Initials on the brand gradient identify the user perfectly well.
 */
export function Avatar({ name, size = 36 }: { readonly name: string; readonly size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: 'var(--gradient-brand)',
      }}
      aria-hidden
    >
      {initials || '?'}
    </span>
  )
}

/**
 * Search field.
 *
 * Placed in the page body rather than the top bar: the thing an operator searches for
 * differs completely by screen (a consignment reference here, a customer TIN there), and a
 * single global box that searches "everything" ends up searching nothing well.
 */
export function SearchField({
  placeholder = 'Search…',
  name = 'q',
  defaultValue,
}: {
  readonly placeholder?: string
  readonly name?: string
  readonly defaultValue?: string
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[var(--text-tertiary)]">
        <SearchIcon />
      </span>
      <input
        type="search"
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="h-9 w-full rounded-md bg-[var(--surface-raised)] pr-3 pl-9 text-base ring-1 ring-[var(--border-default)] ring-inset transition-[box-shadow] duration-[var(--duration-fast)] placeholder:text-[var(--text-tertiary)] hover:ring-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)] focus:outline-none"
      />
    </div>
  )
}

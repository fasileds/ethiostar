'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { Logo } from '../brand/Logo'
import { Icon } from './Icon'
import { CloseIcon, MenuIcon } from './Icon'
import type { NavSection } from './navigation'

/**
 * The application sidebar.
 *
 * A client component only because it needs `usePathname` for the active state and local
 * state for the mobile drawer. The nav TREE is computed on the server and passed in already
 * filtered by permission, so no permission logic ships to the browser.
 *
 * Active state is computed by prefix so `/consignments/abc-123` still highlights
 * "Consignments" — an operator three levels deep should still see where they are.
 */

export interface SideNavProps {
  readonly sections: readonly NavSection[]
  /** Pending-work counts, keyed by NavItem.badgeKey. */
  readonly badges?: Readonly<Record<string, number>>
  readonly locale?: 'en' | 'am'
  /** Portal users get a lighter treatment; staff get the full brand rail. */
  readonly variant?: 'staff' | 'portal'
  /** Where the logo links. Defaults per variant — a customer must not land on /dashboard. */
  readonly homeHref?: string
}

export function SideNav({
  sections,
  badges = {},
  locale = 'en',
  variant = 'staff',
  homeHref,
}: SideNavProps) {
  const home = homeHref ?? (variant === 'portal' ? '/portal/dashboard' : '/dashboard')
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Mobile trigger. Sits over the top bar's reserved slot, so it reads as part of the
          bar rather than as a control floating on top of the page. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="fixed top-3.5 left-4 z-40 inline-flex size-9 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] lg:hidden"
      >
        <MenuIcon />
      </button>

      {/* Scrim. Fades rather than appearing, so the drawer does not arrive with a slam. */}
      {open ? (
        <button
          type="button"
          className="animate-in fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] lg:hidden"
          onClick={() => setOpen(false)}
          aria-label="Close navigation"
        />
      ) : null}

      <nav
        data-app-nav
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col transition-transform duration-[var(--duration-slow)] ease-[var(--ease-out)] lg:translate-x-0 ${
          open ? 'translate-x-0 shadow-lg lg:shadow-none' : '-translate-x-full'
        } ${variant === 'staff' ? 'surface-brand-gradient text-white' : 'bg-[var(--surface-raised)] ring-1 ring-[var(--border-subtle)]'}`}
        aria-label="Main navigation"
      >
        <div
          className={`flex h-16 shrink-0 items-center justify-between px-4 ${
            variant === 'staff'
              ? 'border-b border-white/10'
              : 'border-b border-[var(--border-subtle)]'
          }`}
        >
          <Link href={home} className="rounded focus-visible:outline-offset-4">
            <Logo size="sm" onDark={variant === 'staff'} />
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={`inline-flex size-9 items-center justify-center rounded-md lg:hidden ${
              variant === 'staff'
                ? 'text-white/70 hover:bg-white/10'
                : 'hover:bg-[var(--surface-sunken)]'
            }`}
            aria-label="Close navigation"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {sections.map((section) => (
            <NavGroup
              key={section.title}
              section={section}
              badges={badges}
              locale={locale}
              variant={variant}
              onNavigate={() => setOpen(false)}
            />
          ))}
        </div>

        {/* The gold hairline ties the rail to the logo gradient. */}
        {variant === 'staff' ? (
          <div
            className="h-0.5 shrink-0"
            style={{ background: 'linear-gradient(90deg, transparent, #c9cb46, transparent)' }}
            aria-hidden
          />
        ) : null}
      </nav>
    </>
  )
}

function NavGroup({
  section,
  badges,
  locale,
  variant,
  onNavigate,
}: {
  readonly section: NavSection
  readonly badges: Readonly<Record<string, number>>
  readonly locale: 'en' | 'am'
  readonly variant: 'staff' | 'portal'
  readonly onNavigate: () => void
}) {
  const pathname = usePathname()
  const onDark = variant === 'staff'

  return (
    <div className="mb-5 last:mb-0">
      <p
        className={`mb-1.5 px-3 text-2xs font-semibold tracking-[0.11em] uppercase ${
          onDark ? 'text-white/45' : 'text-[var(--text-tertiary)]'
        }`}
      >
        {locale === 'am' ? section.titleAm : section.title}
      </p>

      <ul className="space-y-0.5">
        {section.items.map((item) => {
          // Prefix match, so a detail page keeps its parent highlighted.
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          const count = item.badgeKey ? (badges[item.badgeKey] ?? 0) : 0

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-base transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${
                  onDark
                    ? active
                      ? 'bg-white/15 font-medium text-white'
                      : 'text-white/75 hover:bg-white/10 hover:text-white'
                    : active
                      ? 'bg-brand-50 font-medium text-brand-900 dark:bg-brand-900/30 dark:text-brand-100'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
                }`}
              >
                {/* A hard accent on the active item. The tinted background alone is easy to
                    lose against the gradient rail; an edge is not. */}
                {active ? (
                  <span
                    className={`absolute inset-y-1 left-0 w-0.5 rounded-full ${
                      onDark ? 'bg-gold-500' : 'bg-brand-700 dark:bg-brand-400'
                    }`}
                    aria-hidden
                  />
                ) : null}

                {/* Inactive icons sit back a step so the labels carry the scanning, and the
                    active row reads as the only fully-lit thing in the list. */}
                <span
                  className={`shrink-0 transition-opacity duration-[var(--duration-fast)] ${
                    active ? 'opacity-100' : 'opacity-65 group-hover:opacity-100'
                  }`}
                >
                  <Icon name={item.icon} />
                </span>

                <span className="flex-1 truncate" lang={locale}>
                  {locale === 'am' ? item.labelAm : item.label}
                </span>

                {count > 0 ? (
                  <span
                    className={`numeric inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-2xs font-semibold ${
                      onDark ? 'bg-gold-500 text-brand-950' : 'bg-brand-700 text-white'
                    }`}
                    aria-label={`${count} awaiting action`}
                  >
                    {count > 99 ? '99+' : count}
                  </span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

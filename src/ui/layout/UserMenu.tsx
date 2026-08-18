'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Avatar } from './TopBar'
import { signOutAction } from '../../app/(auth)/login/actions'

/**
 * The account menu.
 *
 * Sign-out is a FORM posting to a Server Action, not a link. A GET that mutates session
 * state is triggerable by a prefetch or an image tag — and Next.js prefetches links
 * aggressively, which would sign people out as they hover.
 */
export function UserMenu({ name, email }: { readonly name: string; readonly email: string }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center justify-center rounded-full focus-visible:outline-offset-4 sm:hidden"
        aria-label="Account menu"
      >
        <Avatar name={name} size={34} />
      </button>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="hidden size-9 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text-primary)] sm:inline-flex"
        aria-label="Account menu"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
          <path d="M10 13.5 4.5 8h11L10 13.5Z" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          // --surface-overlay, not --surface-raised: in dark mode a drop shadow cannot
          // separate a panel from the page behind it, so the menu is a lighter surface.
          className="animate-in absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg bg-[var(--surface-overlay)] shadow-lg ring-1 ring-[var(--border-default)]"
        >
          <div className="border-b border-[var(--border-subtle)] px-3.5 py-3">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="truncate text-xs text-[var(--text-tertiary)]">{email}</p>
          </div>

          <div className="py-1">
            <Link
              href="/profile"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3.5 py-2 text-sm text-[var(--text-secondary)] transition-colors duration-[var(--duration-fast)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              Profile &amp; password
            </Link>
          </div>

          <div className="border-t border-[var(--border-subtle)] py-1">
            {/* A POST, deliberately: Next prefetches links, and a GET sign-out would log
                people out as they hover. */}
            <form action={signOutAction}>
              <button
                type="submit"
                role="menuitem"
                className="block w-full px-3.5 py-2 text-left text-sm text-danger-700 hover:bg-danger-50 dark:text-danger-100 dark:hover:bg-danger-900/20"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

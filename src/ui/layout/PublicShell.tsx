import * as React from 'react'
import Link from 'next/link'
import { Logo } from '../brand/Logo'

/**
 * The chrome for the pages an applicant sees before they have an account: the landing page,
 * the application form, and the two status pages.
 *
 * These four screens each grew their own copy of the same header, and they had already
 * drifted — one carried a sign-in link, two did not, none had a footer, and the landing page
 * had no EthioStar mark on it at all. This is the first thing a prospective customer sees of
 * the company, so it is the last place that should look assembled.
 *
 * A server component with no state: the public pages ship no client JavaScript, and there is
 * nothing here that needs any.
 */

export function PublicShell({
  children,
  /** Right-hand header slot. Defaults to the sign-in link, which is right on every page but
      the one the applicant reached by following it. */
  headerAction = <SignInLink />,
  /** `sunken` for form pages, so the white card lifts off the page behind it. */
  background = 'sunken',
}: {
  readonly children: React.ReactNode
  readonly headerAction?: React.ReactNode
  readonly background?: 'sunken' | 'page'
}) {
  return (
    <div
      className={`flex min-h-dvh flex-col ${
        background === 'sunken' ? 'bg-[var(--surface-sunken)]' : 'bg-[var(--surface-page)]'
      }`}
    >
      <PublicHeader action={headerAction} />
      <div className="flex-1">{children}</div>
      <PublicFooter />
    </div>
  )
}

export function PublicHeader({ action }: { readonly action?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]/85 backdrop-blur-md">
      <div className="container-app flex h-16 items-center justify-between gap-4">
        <Link
          href="/"
          className="rounded focus-visible:outline-offset-4"
          aria-label="EthioStar home"
        >
          <Logo size="sm" />
        </Link>
        {action}
      </div>
      {/* The gold hairline from the logo gradient, tying the public chrome to the brand rail
          the signed-in application uses. */}
      <div
        className="h-px"
        style={{ background: 'linear-gradient(90deg, transparent, #c9cb46, transparent)' }}
        aria-hidden
      />
    </header>
  )
}

export function SignInLink() {
  return (
    <Link
      href="/login"
      className="rounded text-sm font-medium text-[var(--text-brand)] transition-colors duration-[var(--duration-fast)] hover:text-brand-700 hover:underline dark:hover:text-brand-200"
    >
      Already a customer? <span className="whitespace-nowrap">Sign in</span>
    </Link>
  )
}

function PublicFooter() {
  return (
    // No top margin: the flex-1 content region above already pushes this to the bottom on
    // short pages, and each page brings its own closing padding.
    <footer className="border-t border-[var(--border-subtle)] bg-[var(--surface-raised)]">
      <div className="container-app flex flex-col gap-4 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo size="sm" showTagline />
        </div>

        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="Footer">
          <Link
            href="/apply"
            className="rounded text-[var(--text-secondary)] transition-colors duration-[var(--duration-fast)] hover:text-[var(--text-primary)]"
          >
            Apply
          </Link>
          <Link
            href="/apply/status"
            className="rounded text-[var(--text-secondary)] transition-colors duration-[var(--duration-fast)] hover:text-[var(--text-primary)]"
          >
            Check an application
          </Link>
          <Link
            href="/login"
            className="rounded text-[var(--text-secondary)] transition-colors duration-[var(--duration-fast)] hover:text-[var(--text-primary)]"
          >
            Sign in
          </Link>
        </nav>
      </div>

      <div className="border-t border-[var(--border-subtle)]">
        {/* No year. The landing page is statically rendered, so a server-evaluated
            `getFullYear()` would be baked in at build time and read as stale from the 1st of
            January until the next deploy — and the lint rule banning `new Date()` here is
            pointing at exactly that class of bug. */}
        <p className="container-app py-4 text-2xs text-[var(--text-tertiary)]">
          &copy; EthioStar Coffee Sorting &amp; Processing Services.
        </p>
      </div>
    </footer>
  )
}

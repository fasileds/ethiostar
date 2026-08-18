'use client'

import { Button, ButtonLink } from '@ui/primitives/Button'

/**
 * The panel every error boundary renders.
 *
 * Two things it deliberately does NOT do.
 *
 * It does not apologise at length, and it does not say "an unexpected error occurred" and
 * stop. Someone hitting this is mid-task — receiving a truck, or checking whether their
 * coffee has been processed — and the only useful things are a way back in and something to
 * quote when they telephone. So the retry is the primary action and the digest is shown
 * verbatim.
 *
 * It does not print `error.message`. In production Next replaces the message of a Server
 * Component error with a generic string precisely so internal details do not reach the
 * browser, and echoing whatever survives that is how a connection string ends up on a
 * customer's screen. The digest is the safe half of the pair and is what matches the
 * server-side log.
 */
export function ErrorState({
  error,
  retry,
  title = 'Something went wrong',
  description = 'This screen could not be loaded. Trying again usually resolves it — the problem is often a dropped connection rather than your data.',
  homeHref,
}: {
  readonly error: Error & { digest?: string }
  readonly retry: () => void
  readonly title?: string
  readonly description?: string
  /** Where "go back" leads. Differs per area: staff to the dashboard, customers to theirs. */
  readonly homeHref?: string
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-danger-50 text-danger-700 dark:bg-danger-900/25 dark:text-danger-100">
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-6" aria-hidden>
            <path d="M12 2a1.3 1.3 0 0 1 1.14.67l9 16A1.3 1.3 0 0 1 21 20.5H3a1.3 1.3 0 0 1-1.14-1.83l9-16A1.3 1.3 0 0 1 12 2Zm0 5.5a1 1 0 0 0-1 1v5a1 1 0 0 0 2 0v-5a1 1 0 0 0-1-1Zm0 10.75a1.15 1.15 0 1 0 0-2.3 1.15 1.15 0 0 0 0 2.3Z" />
          </svg>
        </div>

        <h1 className="mt-5 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]">
          {description}
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="primary" onClick={() => retry()}>
            Try again
          </Button>
          {homeHref ? (
            <ButtonLink href={homeHref} variant="secondary">
              Go back
            </ButtonLink>
          ) : null}
        </div>

        {error.digest ? (
          <p className="mt-8 border-t border-[var(--border-subtle)] pt-4 text-xs text-[var(--text-tertiary)]">
            Quote this reference if you contact support:{' '}
            <span className="numeric font-medium text-[var(--text-secondary)]">
              {error.digest}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  )
}

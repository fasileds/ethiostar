import Link from 'next/link'
import { ButtonLink } from '@ui/primitives/Button'
import { PublicShell } from '@ui/layout/PublicShell'

export const metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
}

/**
 * The application-wide 404.
 *
 * Rendered in the PUBLIC shell rather than the staff one, because this page is reached by
 * signed-out visitors and signed-in operators alike, and the staff shell needs an actor and a
 * database to render its navigation. Offering both onward routes covers the two audiences
 * without guessing which one arrived.
 */
export default function NotFound() {
  return (
    <PublicShell background="page" headerAction={null}>
      <main className="container-app flex min-h-[60vh] max-w-lg flex-col items-center justify-center py-16 text-center">
        <p className="numeric text-4xl font-semibold text-[var(--text-brand)]">404</p>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          We could not find that page
        </h1>
        <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
          The link may be out of date, or the reference in it may have been mistyped. Nothing
          has been lost — the page simply is not here.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/" variant="primary">
            Back to home
          </ButtonLink>
          <ButtonLink href="/login" variant="secondary">
            Sign in
          </ButtonLink>
        </div>

        <p className="mt-10 border-t border-[var(--border-subtle)] pt-5 text-sm text-[var(--text-secondary)]">
          Looking for an application you submitted?{' '}
          <Link
            href="/apply/status"
            className="rounded font-medium text-[var(--text-brand)] hover:underline"
          >
            Check its status by reference
          </Link>
          .
        </p>
      </main>
    </PublicShell>
  )
}

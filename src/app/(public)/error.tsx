'use client'

import { useEffect } from 'react'
import { ErrorState } from '@ui/patterns/ErrorState'
import { PublicShell } from '@ui/layout/PublicShell'

/**
 * The public error boundary — the landing page, the application form and the status lookup.
 *
 * The audience here has no account and no support contact yet, so the copy points at the
 * branch rather than at "support", and the shell keeps the header and footer so they still
 * have somewhere to go.
 */
export default function PublicError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error('public page failed', error)
  }, [error])

  return (
    <PublicShell background="page">
      <ErrorState
        error={error}
        retry={retry}
        description="This page could not be loaded. Please try again — if it keeps happening, contact your nearest EthioStar branch."
        homeHref="/"
      />
    </PublicShell>
  )
}

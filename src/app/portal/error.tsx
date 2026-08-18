'use client'

import { useEffect } from 'react'
import { ErrorState } from '@ui/patterns/ErrorState'

/**
 * The customer portal error boundary.
 *
 * The wording matters more here than on the staff side. A customer seeing a broken screen in
 * the system that holds several tonnes of their coffee needs to be told, first, that the
 * screen failed and not the custody record.
 */
export default function PortalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error('portal screen failed', error)
  }, [error])

  return (
    <ErrorState
      error={error}
      retry={retry}
      title="This page could not be loaded"
      description="Your coffee and its records are unaffected — this is a problem displaying the page. Please try again, and contact your EthioStar branch if it keeps happening."
      homeHref="/portal/dashboard"
    />
  )
}

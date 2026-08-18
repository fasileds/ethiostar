'use client'

import { useEffect } from 'react'
import { ErrorState } from '@ui/patterns/ErrorState'

/**
 * The staff error boundary.
 *
 * Note the signature: Next 16 passes `retry`, not the `reset` of earlier versions. `retry()`
 * re-fetches and re-renders the segment, which is what is wanted here — most failures on
 * these screens are a dropped database connection, and re-running the query is the fix.
 * `reset()` would only clear the boundary and re-render the same stale tree.
 */
export default function StaffError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    // The server has already logged this with full detail; this is the browser-side half,
    // so a support call can be correlated from either end.
    console.error('staff screen failed', error)
  }, [error])

  return (
    <ErrorState
      error={error}
      retry={retry}
      description="This screen could not be loaded. Trying again usually resolves it — the problem is often a dropped connection rather than your data. Nothing you were working on has been lost."
      homeHref="/dashboard"
    />
  )
}

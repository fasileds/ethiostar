'use client'

import { useEffect } from 'react'
import { ErrorState } from '@ui/patterns/ErrorState'

/**
 * The authentication error boundary.
 *
 * Renders inside the auth layout, so the brand panel stays put and the failure reads as one
 * broken form rather than as EthioStar being down. Deliberately says nothing about WHY
 * sign-in failed — a boundary that distinguishes causes on an unauthenticated screen is an
 * oracle, and the useful diagnosis lives in the server log against the digest.
 */
export default function AuthError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error('auth screen failed', error)
  }, [error])

  return (
    <ErrorState
      error={error}
      retry={retry}
      title="Sign-in is unavailable"
      description="We could not load this screen. Please try again in a moment."
      homeHref="/"
    />
  )
}

'use client'

/**
 * The last-resort error boundary — the root layout itself failed to render.
 *
 * This file REPLACES the root layout when it is active, which has two consequences that
 * shape everything below:
 *
 * 1. It must supply its own `<html>` and `<body>`.
 * 2. It does not get globals.css, the design tokens or the Noto font stack. Every style here
 *    is therefore inline and self-contained. Importing the stylesheet would be pointless —
 *    the whole reason this boundary is showing is that the document shell did not come up.
 *
 * So the brand green and the type ramp are repeated as literals rather than referenced as
 * tokens. That duplication is deliberate and is the only place in the application where it
 * is correct.
 *
 * `metadata` cannot be exported from a client component, so the title is set with React 19's
 * hoisted `<title>` instead.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          background: '#f9f9f8',
          color: '#222222',
          fontFamily: "'Noto Sans', Calibri, system-ui, sans-serif",
          fontSize: '0.875rem',
          lineHeight: 1.6,
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        <title>Something went wrong · EthioStar CPMS</title>

        <main style={{ maxWidth: '28rem', textAlign: 'center' }}>
          <div
            style={{
              width: '3rem',
              height: '3rem',
              margin: '0 auto',
              borderRadius: '999px',
              background: '#fdf1ef',
              color: '#9c3122',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24" aria-hidden>
              <path d="M12 2a1.3 1.3 0 0 1 1.14.67l9 16A1.3 1.3 0 0 1 21 20.5H3a1.3 1.3 0 0 1-1.14-1.83l9-16A1.3 1.3 0 0 1 12 2Zm0 5.5a1 1 0 0 0-1 1v5a1 1 0 0 0 2 0v-5a1 1 0 0 0-1-1Zm0 10.75a1.15 1.15 0 1 0 0-2.3 1.15 1.15 0 0 0 0 2.3Z" />
            </svg>
          </div>

          <h1
            style={{
              margin: '1.25rem 0 0',
              fontSize: '1.375rem',
              fontWeight: 600,
              letterSpacing: '-0.011em',
            }}
          >
            EthioStar is temporarily unavailable
          </h1>

          <p style={{ margin: '0.5rem 0 0', color: '#6b6b6b' }}>
            The application could not start. This is a fault on our side, not with your data or
            your coffee records. Please try again in a moment.
          </p>

          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: '1.5rem',
              height: '2.75rem',
              padding: '0 1.25rem',
              border: 0,
              borderRadius: '0.5rem',
              background: '#357b62',
              color: '#ffffff',
              fontSize: '1rem',
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>

          {error.digest ? (
            <p
              style={{
                margin: '2rem 0 0',
                paddingTop: '1rem',
                borderTop: '1px solid #e4e4e2',
                fontSize: '0.75rem',
                color: '#888888',
              }}
            >
              Quote this reference if you contact support:{' '}
              <span style={{ fontVariantNumeric: 'tabular-nums', color: '#6b6b6b' }}>
                {error.digest}
              </span>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  )
}

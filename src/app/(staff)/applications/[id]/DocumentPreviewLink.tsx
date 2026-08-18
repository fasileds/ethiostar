'use client'

import * as React from 'react'
import { IconButton } from '@ui/primitives/Button'

/**
 * Opens the attached file in an on-page modal instead of a new tab, so a reviewer can look at
 * the document without losing their place on the application.
 *
 * The iframe is pointed at the signed storage URL directly, fetched as JSON from our own
 * `/download` route rather than following it as a redirect — a redirect would carry this
 * app's own `frame-ancestors 'none'` header into the framing navigation and get blocked
 * before ever reaching the file (see the comment on that route).
 */
export function DocumentPreviewLink({
  fileId,
  filename,
}: {
  readonly fileId: string
  readonly filename: string
}) {
  const [open, setOpen] = React.useState(false)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [error, setError] = React.useState(false)

  React.useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)

    let cancelled = false
    setError(false)
    fetch(`/api/v1/files/${fileId}/download`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('download failed'))))
      .then((data: { url: string }) => {
        if (!cancelled) setPreviewUrl(data.url)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      cancelled = true
    }
  }, [open, fileId])

  function close() {
    setOpen(false)
    setPreviewUrl(null)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[var(--text-brand)] underline hover:no-underline"
      >
        {filename}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={filename}
          className="fixed inset-0 z-50 flex h-screen w-screen flex-col bg-transparent"
        >
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-raised)]/80 p-3 backdrop-blur-sm">
            <span className="truncate pr-2 text-sm font-medium">{filename}</span>
            <IconButton label="Close preview" onClick={close}>
              <svg viewBox="0 0 16 16" className="size-4" fill="none" aria-hidden="true">
                <path
                  d="M3 3l10 10M13 3L3 13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </IconButton>
          </div>
          {error ? (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
              Could not load this document.
            </div>
          ) : previewUrl ? (
            <iframe src={previewUrl} title={filename} className="min-h-0 flex-1 bg-white" />
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-secondary)]">
              Loading…
            </div>
          )}
        </div>
      ) : null}
    </>
  )
}

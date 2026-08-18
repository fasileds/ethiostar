import type { IconName } from './navigation'

/**
 * Icon set.
 *
 * Inline SVG on a 24px grid with a 1.75 stroke, drawn to read at 18px on a low-DPI tablet.
 * No icon library: the set is small, fixed, and shipping ~40KB of a library to draw twenty
 * glyphs is a poor trade on a connection that may be the plant's only one.
 *
 * Every icon is `aria-hidden` — they always accompany a text label, never replace it.
 */

const PATHS: Readonly<Record<IconName, React.ReactNode>> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="4.5" rx="1.5" />
      <rect x="13.5" y="10.5" width="7.5" height="10.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  applications: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
  customers: (
    <>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3 3 0 0 1 0 5.5" />
      <path d="M17.5 14.5a5 5 0 0 1 3 5" />
    </>
  ),
  delivery: (
    <>
      <path d="M2.5 7.5h10v9h-10z" />
      <path d="M12.5 11h4l3 3v2.5h-7z" />
      <circle cx="6.5" cy="18" r="1.75" />
      <circle cx="16" cy="18" r="1.75" />
    </>
  ),
  receiving: (
    <>
      <path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5Z" />
      <path d="M3 8.5 12 13l9-4.5M12 13v7" />
    </>
  ),
  consignments: (
    <>
      <path d="M4 6.5 12 3l8 3.5v11L12 21l-8-3.5Z" />
      <path d="M8 4.8v5.4l4 1.8 4-1.8" />
    </>
  ),
  warehouse: (
    <>
      <path d="M3 10.5 12 4l9 6.5V20H3Z" />
      <path d="M8 20v-6h8v6" />
      <path d="M8 17h8" />
    </>
  ),
  stock: (
    <>
      <rect x="3" y="12" width="6" height="8" rx="1" />
      <rect x="9.5" y="8" width="6" height="12" rx="1" />
      <rect x="16" y="4" width="5" height="16" rx="1" />
    </>
  ),
  bags: (
    <>
      <path d="M7 8h10l1.5 12H5.5Z" />
      <path d="M9.5 8V6a2.5 2.5 0 0 1 5 0v2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  processing: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
    </>
  ),
  acceptance: (
    <>
      <path d="M5 4.5h14v15H5z" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  dispatch: (
    <>
      <path d="M2.5 6.5h11v10h-11z" />
      <path d="M13.5 10h4l4 3.5v3h-8z" />
      <circle cx="7" cy="18.5" r="1.75" />
      <circle cx="17" cy="18.5" r="1.75" />
    </>
  ),
  gate: (
    <>
      <path d="M4 20V6.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2V20" />
      <path d="M2 20h20M9 20V11h6v9" />
    </>
  ),
  labour: (
    <>
      <circle cx="12" cy="7" r="3.25" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  printing: (
    <>
      <path d="M7 9V3.5h10V9" />
      <rect x="3.5" y="9" width="17" height="7.5" rx="1.5" />
      <path d="M7 14h10v6.5H7z" />
    </>
  ),
  audit: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 21 21" />
      <path d="M10.5 7.5v3.5l2.5 1.5" />
    </>
  ),
  admin: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.11a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.11A1.6 1.6 0 0 0 4.6 8.99a1.6 1.6 0 0 0-.33-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.6 1.6 0 0 0 1.77.32H9a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.11a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.6 1.6 0 0 0-.32 1.77V9a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.11a1.6 1.6 0 0 0-1.47 1Z" />
    </>
  ),
  documents: (
    <>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z" />
      <path d="M13.5 3v5.5H19" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  tasks: (
    <>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8.5 9.5h7M8.5 13h7M8.5 16.5h4" />
    </>
  ),
}

export function Icon({
  name,
  className = 'size-[18px]',
}: {
  readonly name: IconName
  readonly className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}

/** Small utility glyphs used outside navigation. */
export function ChevronIcon({ className = 'size-4' }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}

export function MenuIcon({ className = 'size-5' }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

export function CloseIcon({ className = 'size-5' }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

export function SearchIcon({ className = 'size-4' }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

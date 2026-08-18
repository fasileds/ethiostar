/**
 * The four landing-page glyphs.
 *
 * Inline and stroked to match @ui/layout/Icon rather than pulled from a library — four
 * glyphs do not justify a dependency, and these are the only four this page needs. They live
 * here rather than in the design system because they illustrate marketing claims, not
 * operational objects, and nothing in the application will ever reach for them.
 */

const STROKE = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '1.7',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'size-5',
  'aria-hidden': true,
} as const

export function ScaleIcon() {
  return (
    <svg {...STROKE}>
      <path d="M12 3v18M7 21h10M3 8l4-3 4 3M3 8l2 5h4l-2-5M13 8l4-3 4 3M13 8l2 5h4l-2-5" />
    </svg>
  )
}

export function TagIcon() {
  return (
    <svg {...STROKE}>
      <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z" />
      <circle cx="7.5" cy="7.5" r="1.2" />
    </svg>
  )
}

export function StackIcon() {
  return (
    <svg {...STROKE}>
      <path d="m12 3 9 4.5-9 4.5-9-4.5L12 3Z" />
      <path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5" />
    </svg>
  )
}

export function SignatureIcon() {
  return (
    <svg {...STROKE}>
      <path d="M3 18c3 0 3-9 6-9s3 6 5 6 2-3 4-3M3 21h18" />
    </svg>
  )
}

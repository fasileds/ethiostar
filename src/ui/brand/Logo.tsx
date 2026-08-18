import Image from 'next/image'
import ethiostarMark from '../../../public/brand/ethiostar-logo.png'

/**
 * The EthioStar brand mark.
 *
 * This is EthioStar's REAL logo, extracted from EthioStar_CPMS_Solution_Overview.pdf v1.0
 * (page 1): an "ES" monogram whose counters form a coffee bean, running a gradient from
 * the brand green #1F4E3D through to the brand gold #C9CB46. The palette in
 * src/ui/styles/tokens.css is built around that same gradient.
 *
 * Two notes for whoever maintains this:
 *
 * 1. THE SOURCE IS A 258×306 PNG lifted from a PDF. It is sharp enough for on-screen use at
 *    the sizes below, but a VECTOR original should be obtained from EthioStar before this
 *    goes on a printed Gate Pass or Mirt Merekebiya (M06), where it will be reproduced at
 *    letterhead size on a laser printer.
 *
 * 2. THE WORDMARK SPELLING is "EthioStar", per the document. The document itself asks:
 *    "Please confirm the exact legal and brand spelling before this document is finalised,
 *    as it will be used across the application, on all printed documents and on
 *    system-generated correspondence." That is open question 1 and it is still open.
 *
 * The vendor's own logo (ElecNovaTech) is also in public/brand/ for reference. It is NOT
 * EthioStar's brand and must not appear in the application chrome.
 */

export interface LogoProps {
  /** `full` = mark + wordmark · `mark` = symbol only · `stacked` = centred, for sign-in. */
  readonly variant?: 'full' | 'mark' | 'stacked'
  readonly size?: 'sm' | 'md' | 'lg' | 'xl'
  readonly className?: string
  /** Renders the service line beneath the wordmark. Sign-in and print headers only. */
  readonly showTagline?: boolean
  /** On a dark brand surface the wordmark must invert; the mark is legible on both. */
  readonly onDark?: boolean
}

const MARK_PX = { sm: 24, md: 30, lg: 42, xl: 64 } as const

const WORDMARK = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-2xl',
  xl: 'text-3xl',
} as const

const TAGLINE = {
  sm: 'text-[9px]',
  md: 'text-2xs',
  lg: 'text-2xs',
  xl: 'text-xs',
} as const

function Mark({ px }: { readonly px: number }) {
  return (
    <Image
      src={ethiostarMark}
      alt=""
      width={px}
      height={px}
      // The source is 258×306 (slightly taller than square); `object-contain` keeps the
      // bean's proportions rather than squashing it into the box.
      className="shrink-0 object-contain"
      style={{ width: px, height: 'auto' }}
      priority
    />
  )
}

function Wordmark({
  size,
  onDark,
  showTagline,
  align = 'start',
}: {
  readonly size: keyof typeof WORDMARK
  readonly onDark: boolean
  readonly showTagline: boolean
  readonly align?: 'start' | 'center'
}) {
  return (
    <span
      className={`flex flex-col leading-none ${align === 'center' ? 'items-center' : 'items-start'}`}
    >
      <span
        className={`font-semibold tracking-tight ${WORDMARK[size]} ${
          onDark ? 'text-white' : 'text-[var(--text-brand)]'
        }`}
      >
        Ethio<span className="font-normal opacity-75">Star</span>
      </span>
      {showTagline ? (
        <span
          className={`mt-1 font-medium tracking-[0.14em] uppercase ${TAGLINE[size]} ${
            onDark ? 'text-white/60' : 'text-[var(--text-tertiary)]'
          }`}
        >
          Coffee Sorting &amp; Processing
        </span>
      ) : null}
    </span>
  )
}

export function Logo({
  variant = 'full',
  size = 'md',
  className = '',
  showTagline = false,
  onDark = false,
}: LogoProps) {
  const px = MARK_PX[size]

  if (variant === 'mark') {
    return (
      <span className={`inline-flex ${className}`}>
        <Mark px={px} />
        <span className="sr-only">EthioStar</span>
      </span>
    )
  }

  if (variant === 'stacked') {
    return (
      <span className={`inline-flex flex-col items-center gap-3 ${className}`}>
        <Mark px={MARK_PX.xl} />
        <Wordmark size={size} onDark={onDark} showTagline={showTagline} align="center" />
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark px={px} />
      <Wordmark size={size} onDark={onDark} showTagline={showTagline} />
    </span>
  )
}

/**
 * Dual-unit quantity display.
 *
 * Every operational quantity in this system is recorded in BOTH kilograms and kesha, and
 * they are independently meaningful: kg is the commercial quantity and the mass-balance
 * unit; kesha is what the store keeper can physically verify at the bay and the basis of
 * labour pay (M18).
 *
 * So they are always shown TOGETHER. A screen that shows only one is a screen where
 * somebody eventually reconciles against the wrong figure.
 *
 * Figures are tabular so a column of weights compares vertically — a proportional figure in
 * a stock table is genuinely harder to scan.
 */

export interface QuantityProps {
  /** Exact decimal string from the database. NEVER a JS number — see core/units. */
  readonly quantityKg: string
  readonly keshaCount: number
  readonly size?: 'sm' | 'md' | 'lg' | 'xl'
  /** `inline` for tables, `stacked` for cards and detail panels. */
  readonly layout?: 'inline' | 'stacked'
  readonly locale?: string
  readonly className?: string
  /** Dims the unit suffixes. Useful in dense tables where the unit is a column header. */
  readonly subtleUnits?: boolean
}

const SIZE = {
  sm: { primary: 'text-xs', secondary: 'text-2xs' },
  md: { primary: 'text-base', secondary: 'text-xs' },
  lg: { primary: 'text-xl', secondary: 'text-sm' },
  xl: { primary: 'text-3xl', secondary: 'text-base' },
} as const

function formatKg(value: string, locale: string): string {
  // Parse for GROUPING ONLY. The exact string is what is displayed for the decimals, so no
  // precision is lost through Number() — the integer part is simply too large to read
  // without separators.
  const [whole = '0', fraction = ''] = value.replace('-', '').split('.')
  const negative = value.startsWith('-')
  const grouped = new Intl.NumberFormat(locale).format(BigInt(whole))
  return `${negative ? '−' : ''}${grouped}${fraction ? `.${fraction}` : ''}`
}

export function Quantity({
  quantityKg,
  keshaCount,
  size = 'md',
  layout = 'inline',
  locale = 'en-US',
  className = '',
  subtleUnits = true,
}: QuantityProps) {
  const s = SIZE[size]
  const unitClass = subtleUnits ? 'opacity-55' : ''

  if (layout === 'stacked') {
    return (
      <span className={`flex flex-col leading-tight ${className}`}>
        <span className={`numeric font-semibold ${s.primary}`}>
          {formatKg(quantityKg, locale)}
          <span className={`ml-1 font-normal ${unitClass}`}>kg</span>
        </span>
        <span className={`numeric mt-0.5 text-[var(--text-secondary)] ${s.secondary}`}>
          {new Intl.NumberFormat(locale).format(keshaCount)}
          <span className={`ml-1 ${unitClass}`}>kesha</span>
        </span>
      </span>
    )
  }

  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`}>
      <span className={`numeric font-semibold ${s.primary}`}>
        {formatKg(quantityKg, locale)}
        <span className={`ml-1 font-normal ${unitClass}`}>kg</span>
      </span>
      <span className={`numeric text-[var(--text-secondary)] ${s.secondary}`}>
        {new Intl.NumberFormat(locale).format(keshaCount)}
        <span className={`ml-1 ${unitClass}`}>kesha</span>
      </span>
    </span>
  )
}

/**
 * Average weight per kesha — shown on every receipt.
 *
 * Flags a divergence from the bag type's standard weight, which is how a mis-keyed weight
 * or a mis-counted bag is caught AT THE BAY rather than at reconciliation weeks later.
 */
export function AverageWeight({
  averageKg,
  standardKg,
  isOutlier = false,
  locale = 'en-US',
}: {
  readonly averageKg: string | null
  readonly standardKg?: string | undefined
  readonly isOutlier?: boolean
  readonly locale?: string
}) {
  if (averageKg === null) {
    return <span className="text-xs text-[var(--text-tertiary)]">—</span>
  }

  return (
    <span
      className={`inline-flex items-baseline gap-1.5 ${isOutlier ? 'text-warning-900 dark:text-warning-100' : ''}`}
    >
      <span className="numeric text-sm font-medium">
        {formatKg(averageKg, locale)}
        <span className="ml-1 font-normal opacity-55">kg/kesha</span>
      </span>
      {isOutlier ? (
        <span
          className="inline-flex items-center gap-1 rounded bg-warning-50 px-1.5 py-0.5 text-2xs font-medium ring-1 ring-inset ring-warning-100 dark:bg-warning-900/25 dark:ring-warning-900"
          title={standardKg ? `Standard is ${standardKg} kg per kesha` : undefined}
        >
          <WarnIcon />
          Outlier
        </span>
      ) : null}
    </span>
  )
}

/**
 * A percentage with a sign and a tone — yields and mass-balance variance.
 *
 * `neutralPositive` matters: a yield of +80% is good, but a mass-balance variance of +0.6%
 * is a problem. The caller says which reading applies rather than the component guessing.
 */
export function Percentage({
  value,
  tone = 'neutral',
  showSign = false,
  size = 'md',
}: {
  readonly value: string
  readonly tone?: 'neutral' | 'good' | 'warn' | 'bad'
  readonly showSign?: boolean
  readonly size?: 'sm' | 'md' | 'lg'
}) {
  const toneClass = {
    neutral: 'text-[var(--text-primary)]',
    good: 'text-success-700 dark:text-success-100',
    warn: 'text-warning-900 dark:text-warning-100',
    bad: 'text-danger-700 dark:text-danger-100',
  }[tone]

  const sizeClass = { sm: 'text-xs', md: 'text-base', lg: 'text-xl' }[size]
  const negative = value.startsWith('-')
  const sign = showSign ? (negative ? '−' : '+') : negative ? '−' : ''

  return (
    <span className={`numeric font-semibold ${toneClass} ${sizeClass}`}>
      {sign}
      {value.replace('-', '')}
      <span className="ml-0.5 font-normal opacity-55">%</span>
    </span>
  )
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3 shrink-0" fill="currentColor" aria-hidden="true">
      <path d="M8 1.5a.9.9 0 0 1 .78.45l6 10.5A.9.9 0 0 1 14 13.8H2a.9.9 0 0 1-.78-1.35l6-10.5A.9.9 0 0 1 8 1.5Zm0 3.4a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 8 4.9Zm0 6.85a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
    </svg>
  )
}

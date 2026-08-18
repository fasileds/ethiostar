import styles from '../landing.module.css'

/**
 * The hero artwork: a consignment as the product actually renders it, tilted into
 * perspective and split across four layers of depth.
 *
 * Deliberately built from the real design tokens and the real type scale, so it stays honest
 * — this is what the customer will see after they sign in, not an illustration of it. The
 * figures are representative sample data, which is why nothing here reads from the database:
 * the landing page is statically rendered and must never wait on Postgres.
 *
 * It is decorative in the accessibility sense — the copy beside it carries the meaning — so
 * the whole deck is hidden from assistive technology rather than announced as a table of
 * numbers that do not belong to the reader.
 */
export function HeroDeck() {
  return (
    <div className={styles.scene} aria-hidden>
      <div className={styles.deck}>
        {/* Back layer — a hint of the list the consignment came from. */}
        <div className={`${styles.layer} ${styles.layerBack} p-4`}>
          <div className="space-y-2.5">
            {[82, 64, 73].map((width, index) => (
              <div key={index} className="flex items-center gap-2.5">
                <span className="size-1.5 shrink-0 rounded-full bg-brand-300" />
                <span
                  className="h-2 rounded-full bg-[var(--surface-sunken)]"
                  style={{ width: `${width}%` }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Main panel — the consignment itself. */}
        <div className={`${styles.layer} ${styles.layerMain} p-5 sm:p-6`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-2xs font-medium tracking-wide text-[var(--text-tertiary)] uppercase">
                Consignment
              </p>
              <p className="numeric mt-1 text-lg font-semibold">CSG-2026-004178</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-coffee-100 px-2.5 py-1 text-2xs font-medium text-coffee-800 ring-1 ring-coffee-200 ring-inset">
              <span className="size-1.5 rounded-full bg-current opacity-70" />
              Processing
            </span>
          </div>

          <div className="mt-5 flex items-baseline gap-3 border-t border-[var(--border-subtle)] pt-5">
            <span className="numeric text-3xl font-semibold">
              12,480
              <span className="ml-1 text-lg font-normal opacity-55">kg</span>
            </span>
            <span className="numeric text-sm text-[var(--text-secondary)]">
              208<span className="ml-1 opacity-55">kesha</span>
            </span>
          </div>

          <div className="mt-5">
            <div className="flex items-baseline justify-between">
              <span className="text-2xs font-medium tracking-wide text-[var(--text-tertiary)] uppercase">
                Lifecycle
              </span>
              <span className="numeric text-2xs text-[var(--text-tertiary)]">Step 7 of 11</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
              <div
                className="h-full rounded-full"
                style={{ width: '64%', background: 'var(--gradient-brand-subtle)' }}
              />
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--border-subtle)] pt-4">
            <div>
              <dt className="text-2xs text-[var(--text-tertiary)]">Store</dt>
              <dd className="numeric mt-0.5 text-sm font-medium">WH-02 · R3 · S07</dd>
            </div>
            <div>
              <dt className="text-2xs text-[var(--text-tertiary)]">Appointment</dt>
              <dd className="numeric mt-0.5 text-sm font-medium">14 Aug, 08:30</dd>
            </div>
          </dl>
        </div>

        {/* Front layer — the yield figure, floating nearest the viewer. */}
        <div className={`${styles.layer} ${styles.layerFront} px-4 py-3`}>
          <p className="text-2xs font-medium tracking-wide text-[var(--text-tertiary)] uppercase">
            Yield reconciled
          </p>
          <p className="numeric mt-1 text-xl font-semibold text-success-700">
            99.4<span className="ml-0.5 text-sm font-normal opacity-55">%</span>
          </p>
        </div>

        {/* A single confirmation pill, furthest forward. */}
        <div
          className={`${styles.layer} ${styles.layerPill} flex items-center gap-2 px-3.5 py-2.5`}
        >
          <span className="flex size-5 items-center justify-center rounded-full bg-success-500 text-white">
            <svg viewBox="0 0 16 16" fill="currentColor" className="size-3">
              <path d="M6.4 11.2 3.6 8.4l-1 1 3.8 3.8 7.2-7.2-1-1z" />
            </svg>
          </span>
          <span className="text-xs font-medium whitespace-nowrap">Weighed at intake</span>
        </div>
      </div>
    </div>
  )
}

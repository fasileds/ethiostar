import Link from 'next/link'
import { Logo } from '@ui/brand/Logo'
import styles from './auth.module.css'

/**
 * The authentication shell.
 *
 * Previously a dark brand panel beside a plain form. That panel carried `text-white` over a
 * `.surface-brand-gradient` that a later utility silently overrode, so the copy was white on
 * a transparent panel — unreadable the moment the app stopped following the OS into dark
 * mode. The utility is fixed in globals.css; this layout is now light by construction, which
 * removes the whole class of failure rather than the one instance of it.
 *
 * The left column earns its place: someone reaching a sign-in form for a system holding
 * several tonnes of their coffee is reassured by seeing what the system promises. On anything
 * below `lg` it collapses to just the mark — a full-height panel of marketing copy above a
 * login form on a phone is a scroll for no reason.
 */

const ASSURANCES = [
  'Every consignment tracked through eleven stages',
  'Weighed independently at intake, input and output',
  'Recorded in kilograms and kesha, always together',
]

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-[var(--surface-page)]">
      <div className={styles.ambient} aria-hidden>
        <span className={`${styles.orb} ${styles.orbGreen}`} />
        <span className={`${styles.orb} ${styles.orbGold}`} />
      </div>
      <div className={styles.grid} aria-hidden />

      <div className="relative flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="grid w-full max-w-5xl items-center gap-12 lg:grid-cols-[1fr_26rem] lg:gap-16">
          {/* ── Brand and promise ──────────────────────────────────────── */}
          <div className="lg:pr-4">
            <Link href="/" className="inline-flex rounded focus-visible:outline-offset-4">
              <span className="lg:hidden">
                <Logo size="md" />
              </span>
              <span className="hidden lg:inline-flex">
                <Logo size="lg" showTagline />
              </span>
            </Link>

            <div className="hidden lg:block">
              <h2 className="mt-10 text-3xl leading-tight font-semibold tracking-tight text-balance">
                Every kilogram accounted for, from gate&#8209;in to gate&#8209;out.
              </h2>

              <ul className="mt-8 space-y-4">
                {ASSURANCES.map((line) => (
                  <li key={line} className="flex items-start gap-3">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 ring-1 ring-brand-200">
                      <svg
                        viewBox="0 0 16 16"
                        fill="currentColor"
                        className="size-3"
                        aria-hidden
                      >
                        <path d="M6.4 11.2 3.6 8.4l-1 1 3.8 3.8 7.2-7.2-1-1z" />
                      </svg>
                    </span>
                    <span className="text-sm leading-relaxed text-[var(--text-secondary)]">
                      {line}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-10 border-t border-[var(--border-subtle)] pt-5 text-2xs text-[var(--text-tertiary)]">
                EthioStar Coffee Sorting &amp; Processing Services
              </p>
            </div>
          </div>

          {/* ── The form ───────────────────────────────────────────────── */}
          <main className="w-full">
            <div
              className={`${styles.card} animate-in rounded-2xl bg-[var(--surface-raised)] p-6 shadow-lg ring-1 ring-[var(--border-subtle)] sm:p-8`}
            >
              {children}
            </div>

            <p className="mt-5 text-center text-xs text-[var(--text-tertiary)]">
              Trouble signing in? Contact your EthioStar branch.
            </p>
          </main>
        </div>
      </div>
    </div>
  )
}

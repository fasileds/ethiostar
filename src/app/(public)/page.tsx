import { ButtonLink } from '@ui/primitives/Button'
import { PublicShell } from '@ui/layout/PublicShell'
import { HeroDeck } from './_components/HeroDeck'
import { ScaleIcon, TagIcon, StackIcon, SignatureIcon } from './_components/LandingIcons'
import styles from './landing.module.css'

export const metadata = {
  title: 'EthioStar — Coffee Sorting & Processing Services',
  description:
    'Coffee Processing Management System. Track your consignment from gate-in to gate-out.',
}

/**
 * The landing page.
 *
 * The audience is a coffee exporter deciding whether to hand EthioStar several tonnes of
 * their crop. The thing that wins that decision is not a feature list — it is the promise
 * that they will always know where their coffee is and that every kilogram is accounted for.
 * So the page leads with the custody claim, and then SHOWS the product making it: the hero
 * artwork is a real consignment card, in the real type and the real colours, rather than a
 * stock photograph of coffee cherries.
 *
 * Light throughout. The brand green is an accent on white here, not a canvas — a dark hero
 * makes the rest of the page read as an afterthought.
 *
 * Statically rendered: no data, no session, no reason to touch the database.
 */

const ASSURANCES = [
  {
    title: 'Weighed independently, three times',
    body: 'At receipt, at processing input and at every output — with a yield reconciliation showing where each kilogram went.',
    icon: <ScaleIcon />,
  },
  {
    title: 'One identity, gate-in to gate-out',
    body: 'Every consignment carries a permanent reference through eleven tracked stages. Nothing is filed under a name and a date.',
    icon: <TagIcon />,
  },
  {
    title: 'Recorded in kilograms and kesha',
    body: 'Both units, always together — the commercial quantity and the count your store keeper can physically verify at the bay.',
    icon: <StackIcon />,
  },
  {
    title: 'Nothing leaves without a signature',
    body: 'Processed coffee is presented for your acceptance. Until the Mirt Merekebiya is signed, it cannot be collected.',
    icon: <SignatureIcon />,
  },
]

const STATS = [
  { value: '11', label: 'Tracked stages' },
  { value: 'kg + kesha', label: 'Dual-unit record' },
  { value: '3×', label: 'Independent weighings' },
  { value: '24/7', label: 'Customer portal' },
]

/** The five stages a customer actually asks about, out of the eleven that are tracked. */
const LIFECYCLE = [
  { label: 'Requested', note: 'You raise a delivery request' },
  { label: 'Received', note: 'Weighed and counted at the bay' },
  { label: 'Stored', note: 'Placed at a defined location' },
  { label: 'Processed', note: 'Sorted, hulled or graded' },
  { label: 'Collected', note: 'Signed for and gate-cleared' },
]

export default function LandingPage() {
  return (
    <PublicShell background="page" headerAction={<HeaderActions />}>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className={styles.ambient} aria-hidden>
          <span className={`${styles.orb} ${styles.orbGreen}`} />
          <span className={`${styles.orb} ${styles.orbGold}`} />
        </div>
        <div className={styles.grid} aria-hidden />

        <div className="container-app relative grid items-center gap-14 py-16 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:py-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--surface-raised)] py-1.5 pr-4 pl-1.5 text-xs font-medium shadow-xs ring-1 ring-[var(--border-subtle)]">
              <span className="inline-flex items-center rounded-full bg-brand-700 px-2 py-0.5 text-2xs font-semibold tracking-wide text-white uppercase">
                CPMS
              </span>
              <span className="text-[var(--text-secondary)]">
                Coffee Sorting &amp; Processing Services
              </span>
            </span>

            <h1 className="mt-6 text-3xl leading-[1.12] font-semibold tracking-tight text-balance sm:text-4xl lg:text-[3.25rem]">
              Every kilogram{' '}
              <span className="relative whitespace-nowrap">
                <span className="relative z-10">accounted for</span>
                {/* A hand-drawn-feeling highlight rather than a solid marker block, which at
                    this size would swallow the descenders. */}
                <span
                  className="absolute inset-x-0 bottom-1 z-0 h-3 rounded-sm bg-gold-300/55 sm:h-4"
                  aria-hidden
                />
              </span>
              , from gate&#8209;in to gate&#8209;out.
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--text-secondary)]">
              See how much of your coffee is in EthioStar&rsquo;s custody, at which stage, and
              on which appointment date — at any hour, without telephoning the plant.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/apply" variant="primary" size="lg">
                Apply to use our service
              </ButtonLink>
              <ButtonLink href="/login" variant="secondary" size="lg">
                Customer sign in
              </ButtonLink>
            </div>

            <dl className="mt-12 grid max-w-lg grid-cols-2 gap-x-6 gap-y-5 border-t border-[var(--border-subtle)] pt-7 sm:grid-cols-4">
              {STATS.map((stat) => (
                <div key={stat.label}>
                  <dt className="numeric text-xl font-semibold text-[var(--text-brand)]">
                    {stat.value}
                  </dt>
                  <dd className="mt-1 text-xs leading-snug text-[var(--text-tertiary)]">
                    {stat.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <HeroDeck />
        </div>
      </section>

      {/* ── Lifecycle ────────────────────────────────────────────────────── */}
      <section className="container-app py-16 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight">
            You can see it at every stage
          </h2>
          <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
            Eleven stages are tracked internally. These are the five your portal answers for,
            without a telephone call.
          </p>
        </div>

        <ol className={`${styles.rail} mt-10 grid gap-6 md:grid-cols-5`}>
          {LIFECYCLE.map((stage, index) => (
            <li key={stage.label} className="relative">
              <span className="numeric relative z-10 inline-flex size-9 items-center justify-center rounded-full bg-[var(--surface-raised)] text-sm font-semibold text-[var(--text-brand)] shadow-sm ring-1 ring-[var(--border-subtle)]">
                {index + 1}
              </span>
              <h3 className="mt-4 font-semibold">{stage.label}</h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--text-secondary)]">
                {stage.note}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── What custody actually means ──────────────────────────────────── */}
      <section className="container-app pb-16 sm:pb-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight">
            Custody you can check, not custody you are promised
          </h2>
          <p className="mt-3 leading-relaxed text-[var(--text-secondary)]">
            Coffee handed to a processor usually disappears into a paper ledger until it comes
            back. These are the four things EthioStar does differently.
          </p>
        </div>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {ASSURANCES.map((item) => (
            <li
              key={item.title}
              className={`${styles.feature} rounded-xl bg-[var(--surface-raised)] p-6 shadow-xs ring-1 ring-[var(--border-subtle)]`}
            >
              <span
                className="inline-flex size-11 items-center justify-center rounded-xl text-white shadow-sm"
                style={{ background: 'var(--gradient-brand-subtle)' }}
              >
                {item.icon}
              </span>
              <h3 className="mt-5 font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Closing action ───────────────────────────────────────────────── */}
      <section className="container-app pb-20">
        <div className="relative overflow-hidden rounded-2xl bg-[var(--surface-raised)] p-8 shadow-sm ring-1 ring-[var(--border-subtle)] sm:p-12">
          <span
            className="absolute -top-24 -right-16 size-72 rounded-full opacity-40 blur-3xl"
            style={{
              background: 'radial-gradient(circle, var(--color-gold-200), transparent 70%)',
            }}
            aria-hidden
          />

          <div className="relative flex flex-col gap-7 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-lg">
              <h2 className="text-2xl font-semibold tracking-tight">
                Ready to bring coffee to EthioStar?
              </h2>
              <p className="mt-2.5 leading-relaxed text-[var(--text-secondary)]">
                Tell us about your business and what you need. We review applications and reply
                within a few working days — you will get a reference to track it with.
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap gap-3">
              <ButtonLink href="/apply" variant="primary" size="lg">
                Apply now
              </ButtonLink>
              <ButtonLink href="/apply/status" variant="secondary" size="lg">
                Check an application
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </PublicShell>
  )
}

function HeaderActions() {
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <ButtonLink href="/login" variant="ghost" size="sm">
        Sign in
      </ButtonLink>
      <ButtonLink href="/apply" variant="primary" size="sm">
        Apply
      </ButtonLink>
    </div>
  )
}

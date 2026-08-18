import type { Metadata } from 'next'
import Link from 'next/link'
import { publicFormOptions, publicKycRequirements } from '@modules/onboarding'
import { checkDatabase, queryOr } from '@server/readiness'
import { PublicShell } from '@ui/layout/PublicShell'
import { ApplyForm } from './ApplyForm'

export const metadata: Metadata = {
  title: 'Apply to use EthioStar',
  description:
    'Apply to store and process coffee with EthioStar Coffee Sorting & Processing Services.',
}

/**
 * The public application page.
 *
 * Rendered dynamically rather than statically: the branch and coffee-type lists come from
 * master data, and a build-time snapshot would offer a branch that has since closed.
 */
export const dynamic = 'force-dynamic'

export default async function ApplyPage() {
  const readiness = await checkDatabase()

  const [options, kycRequirements] = await Promise.all([
    queryOr(
      { branches: [], businessTypes: [], regions: [], coffeeTypes: [] },
      publicFormOptions,
    ),
    queryOr([], publicKycRequirements),
  ])

  return (
    <PublicShell>
      <main className="container-app max-w-3xl py-8 sm:py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Apply to use our service</h1>
          <p className="mt-2 max-w-2xl leading-relaxed text-[var(--text-secondary)]">
            Tell us about your business and what you need. We will review your application and
            contact you — usually within a few working days.
          </p>
        </div>

        <div className="rounded-xl bg-[var(--surface-raised)] p-5 shadow-sm ring-1 ring-[var(--border-subtle)] sm:p-8">
          <ApplyForm
            branches={options.branches}
            businessTypes={options.businessTypes}
            regions={options.regions}
            coffeeTypes={options.coffeeTypes}
            kycRequirements={kycRequirements}
            disabled={!readiness.ready}
          />
        </div>

        <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
          Already applied?{' '}
          <Link
            href="/apply/status"
            className="rounded font-medium text-[var(--text-brand)] hover:underline"
          >
            Check the status of your application
          </Link>
        </p>
      </main>
    </PublicShell>
  )
}

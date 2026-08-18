import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { PublicShell } from '@ui/layout/PublicShell'
import { Button } from '@ui/primitives/Button'

export const metadata: Metadata = { title: 'Check your application' }

/**
 * The reference entry form.
 *
 * A plain GET form that redirects to /apply/status/<reference>. Keeping the reference in the
 * path rather than the query string means the applicant can bookmark the result — and it
 * keeps the lookup on one code path, whether they arrive by typing or by following the link
 * from their confirmation email.
 */
export default function ApplicationStatusEntryPage() {
  async function lookup(formData: FormData) {
    'use server'
    const reference = String(formData.get('reference') ?? '')
      .trim()
      .toUpperCase()

    if (!reference) redirect('/apply/status')
    redirect(`/apply/status/${encodeURIComponent(reference)}`)
  }

  return (
    <PublicShell>
      <main className="container-app max-w-lg py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Check your application</h1>
        <p className="mt-2 leading-relaxed text-[var(--text-secondary)]">
          Enter the reference we gave you when you applied. It starts with{' '}
          <span className="numeric">APP-</span>.
        </p>

        <form
          action={lookup}
          className="mt-6 rounded-xl bg-[var(--surface-raised)] p-5 shadow-sm ring-1 ring-[var(--border-subtle)] sm:p-6"
        >
          {/* Not the shared `Input`: that is a client component, and this page is otherwise a
              pure server-rendered GET form with no JavaScript at all. The classes below are
              the same recipe — `h-11` because a reference is transcribed from an email on a
              phone, and this is the only field on the screen. */}
          <label htmlFor="reference" className="mb-1.5 block text-sm font-medium">
            Application reference
          </label>
          <input
            id="reference"
            name="reference"
            required
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters"
            placeholder="APP-2026-XXXXXXXXXXXXXXXXXXXX"
            className="numeric h-11 w-full rounded-md bg-[var(--surface-raised)] px-3 text-base uppercase ring-1 ring-inset ring-[var(--border-default)] transition-[box-shadow] duration-[var(--duration-fast)] placeholder:text-[var(--text-tertiary)] placeholder:normal-case hover:ring-[var(--border-strong)] focus:ring-2 focus:ring-[var(--focus-ring)] focus:outline-none"
          />

          <Button type="submit" variant="primary" size="lg" fullWidth className="mt-4">
            Check status
          </Button>
        </form>

        <p className="mt-6 text-sm leading-relaxed text-[var(--text-secondary)]">
          Lost your reference? Contact the branch you applied to — they can find it from your
          business name and phone number.
        </p>
      </main>
    </PublicShell>
  )
}

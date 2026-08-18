import { redirect } from 'next/navigation'
import { getActor } from '@server/auth/dal'
import { checkDatabase } from '@server/readiness'
import { SideNav } from '@ui/layout/SideNav'
import { TopBar } from '@ui/layout/TopBar'
import { PORTAL_NAV } from '@ui/layout/navigation'
import { UserMenu } from '@ui/layout/UserMenu'
import { isProduction } from '@config/env'

/**
 * The customer portal shell.
 *
 * A lighter treatment than the staff rail. This is a customer's view of their own coffee, not
 * an operations console, and dressing it in the full brand gradient would make it feel like
 * they had been let into EthioStar's back office.
 *
 * The nav is NOT permission-filtered: a customer either has portal access or does not. Their
 * scoping happens at the data layer, where `fn_owns_customer` restricts every row to the
 * customer bound to their user record.
 */
export const dynamic = 'force-dynamic'

export default async function PortalLayout({ children }: LayoutProps<'/'>) {
  const readiness = await checkDatabase()
  const actor = readiness.ready ? await getActor() : null

  if (readiness.ready && !actor) redirect('/login')

  // A staff member reaching a portal URL is a routing mistake rather than an attack, but they
  // must not land here: every portal query scopes by customer_id, which a staff actor does
  // not carry, so the page would render as an empty account rather than as an error.
  if (actor && actor.actorKind !== 'customer') redirect('/dashboard')

  return (
    <div className="min-h-dvh">
      <SideNav sections={PORTAL_NAV} variant="portal" locale={actor?.locale ?? 'en'} />

      <div className="lg:pl-[264px]">
        <TopBar
          actor={{
            fullName: actor?.fullName ?? 'Not signed in',
            email: actor?.email ?? '',
            roleLabel: 'Customer',
          }}
          environment={isProduction() ? 'production' : 'development'}
          userMenu={<UserMenu name={actor?.fullName ?? '—'} email={actor?.email ?? ''} />}
        />

        <main className="container-app py-6 sm:py-8">{children}</main>
      </div>
    </div>
  )
}

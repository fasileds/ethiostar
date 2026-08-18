import { redirect } from 'next/navigation'
import { getActor } from '@server/auth/dal'
import { checkDatabase } from '@server/readiness'
import { SideNav } from '@ui/layout/SideNav'
import { TopBar } from '@ui/layout/TopBar'
import { STAFF_NAV, visibleSections } from '@ui/layout/navigation'
import { UserMenu } from '@ui/layout/UserMenu'
import { ROLES } from '@modules/identity'
import { isProduction } from '@config/env'

/**
 * The staff back-office shell.
 *
 * Resolves the actor ONCE and filters the navigation by the permissions they actually hold,
 * so a Store Keeper never sees a Finance link to be refused at. That filtering is a UI
 * courtesy, not a security control — the real check happens in the use case, next to the
 * data (docs/adr/0011).
 *
 * Note the layout does NOT gate the page content. A Next.js layout does not control whether
 * its children render, so a guard here would be theatre; the redirect below is for the
 * unauthenticated case only, and each page re-establishes its own authority.
 *
 * When the database is not ready the shell still renders with an empty nav, so the design
 * is reviewable on a fresh clone. See src/server/readiness.ts.
 */
/**
 * Never prerendered, never cached.
 *
 * Every page under this layout is scoped to the signed-in actor: their permissions filter the
 * nav, their claims scope every query, and RLS is evaluated against their JWT. A statically
 * generated copy would be one user's data served to the next, so the correctness argument and
 * the security argument point the same way.
 *
 * It also keeps `next build` honest: without this, the build renders these pages at build
 * time, where there is no request, no session and no database — and the failure surfaces as a
 * confusing environment error rather than as "you cannot prerender an authenticated page".
 */
export const dynamic = 'force-dynamic'

export default async function StaffLayout({ children }: LayoutProps<'/'>) {
  const readiness = await checkDatabase()
  const actor = readiness.ready ? await getActor() : null

  // Unauthenticated users never reach a staff page — proxy.ts redirects first; this is the
  // belt to that braces, for the case where the proxy matcher misses a route.
  if (readiness.ready && !actor) redirect('/login')

  // A customer reaching a staff URL sees an operations console scoped to a customer_id they
  // do not carry: every panel renders empty, which reads as "the system lost my coffee"
  // rather than as a wrong turn. The proxy already routes them by claim; this re-checks it
  // against the database, where actor_kind is authoritative.
  if (actor && actor.actorKind === 'customer') redirect('/portal/dashboard')

  const permissions = actor?.permissions ?? new Set<string>()
  const sections = visibleSections(STAFF_NAV, permissions)

  const roleLabel =
    ROLES.find((role) => actor?.roles.includes(role.code))?.nameEn ??
    (readiness.ready ? 'No role assigned' : 'Database not ready')

  return (
    <div className="min-h-dvh">
      <SideNav sections={sections} variant="staff" locale={actor?.locale ?? 'en'} />

      <div className="lg:pl-[264px]">
        <TopBar
          actor={{
            fullName: actor?.fullName ?? 'Not signed in',
            email: actor?.email ?? '',
            roleLabel,
          }}
          environment={isProduction() ? 'production' : 'development'}
          userMenu={<UserMenu name={actor?.fullName ?? '—'} email={actor?.email ?? ''} />}
        />

        <main className="container-app py-6 sm:py-8">{children}</main>
      </div>
    </div>
  )
}

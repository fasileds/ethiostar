/**
 * Bootstrap the first staff account.
 *
 * WHY THIS EXISTS
 *
 * The seeds create the 85 permissions, the 12 roles and the master data, but they do NOT
 * create a user — deliberately, because a seeded account with a known password is how a
 * demo database becomes a production one. So a freshly migrated database has a complete
 * schema and nobody who can sign in, and there is no way through the UI to fix that: staff
 * accounts are issued by EthioStar, and the public form creates customer APPLICATIONS, not
 * staff logins.
 *
 * This closes that gap once. After the first System Administrator exists, every other
 * account is created through the application.
 *
 * WHAT IT DOES
 *
 *   1. Creates the Supabase Auth user (service-role Admin API), with `email_confirm` set —
 *      no confirmation mail is needed, which matters because SMTP may not be wired up yet.
 *   2. The `trg_auth_users__create_profile` trigger on auth.users then writes the matching
 *      public.app_user row from the metadata passed in below. This script does not insert
 *      that row itself; duplicating the trigger's logic is how the two drift apart.
 *   3. Grants the role, which the trigger does not do.
 *
 * The password is REQUIRED to be supplied by the operator and is never defaulted. The
 * account is created with must_change_password = true, so it is a handover credential
 * rather than a permanent one: proxy.ts forces /first-login before anything else renders.
 *
 * USAGE
 *
 *   tsx scripts/create-admin.ts --email you@ethiostar.com --name "Full Name" [--role CODE]
 *
 * The password is read from the ADMIN_PASSWORD environment variable so it does not end up
 * in the shell history:
 *
 *   ADMIN_PASSWORD='...' tsx scripts/create-admin.ts --email ... --name ...
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DIRECT_URL.
 */

import postgres from 'postgres'

/**
 * The Auth Admin API is called with plain `fetch`, NOT with `@supabase/supabase-js`.
 *
 * `createClient` constructs a RealtimeClient eagerly, which needs a global WebSocket. Node 20
 * does not have one, so importing the SDK here fails at construction with
 * "Node.js 20 detected without native WebSocket support" — before it ever reaches the one
 * REST call this script actually needs. The app itself is unaffected: it runs inside Next,
 * where WebSocket is global.
 *
 * `package.json` allows Node >= 20.9, so requiring Node 22 to create the first user would be
 * a worse trade than one fetch.
 */

interface Args {
  email: string
  name: string
  role: string
}

function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }

  const email = get('--email')
  const name = get('--name')
  const role = get('--role') ?? 'SYSTEM_ADMINISTRATOR'

  if (!email || !name) {
    console.error(
      'Usage: ADMIN_PASSWORD=... tsx scripts/create-admin.ts --email <email> --name "<full name>" [--role CODE]',
    )
    process.exit(1)
  }

  return { email, name, role }
}

async function main(): Promise<void> {
  const { email, name, role } = parseArgs(process.argv.slice(2))

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const directUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL
  const password = process.env.ADMIN_PASSWORD

  if (!supabaseUrl || !serviceKey) {
    console.error('✖ NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
    process.exit(1)
  }
  if (!directUrl) {
    console.error('✖ DIRECT_URL (or DATABASE_URL) must be set.')
    process.exit(1)
  }
  if (!password) {
    console.error(
      '✖ ADMIN_PASSWORD must be set. It is not defaulted on purpose — a bootstrap\n' +
        '  account with a predictable password is worse than no account at all.',
    )
    process.exit(1)
  }
  if (password.length < 12) {
    console.error('✖ ADMIN_PASSWORD must be at least 12 characters.')
    process.exit(1)
  }

  // `user_metadata` here lands in auth.users.raw_user_meta_data, which is exactly where
  // trg_auth_users__create_profile reads every field it needs.
  // `email_confirm` skips the confirmation mail — necessary, because SMTP may not be wired
  // up yet and the first administrator must not depend on it.
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: name,
        actor_kind: 'staff',
        must_change_password: true,
        preferred_locale: 'en',
      },
    }),
  })

  const payload = (await response.json()) as { id?: string; msg?: string; message?: string }
  const failure = payload.msg ?? payload.message ?? response.statusText

  const sql = postgres(directUrl, { max: 1, prepare: false })

  try {
    let userId: string

    if (response.ok && payload.id) {
      userId = payload.id
      console.log(`✓ auth user created — ${email} (${userId})`)
    } else if (/already been registered/i.test(failure)) {
      // Idempotent: a previous run may have created the account and then failed on the
      // role grant. Re-running should finish the job rather than refuse to start.
      const existing = await sql<{ id: string }[]>`
        select id from public.app_user where email = ${email}
      `
      if (existing.length === 0 || !existing[0]) {
        console.error(`✖ ${email} exists in auth.users but has no app_user profile.`)
        process.exit(1)
      }
      userId = existing[0].id
      console.log(`• auth user already existed — ${email} (${userId}), continuing`)
    } else {
      console.error(`✖ Could not create the auth user: ${failure}`)
      process.exit(1)
    }

    const profile = await sql`
      select id from public.app_user where id = ${userId}
    `
    if (profile.length === 0) {
      console.error(
        '✖ auth.users row exists but public.app_user does not — the\n' +
          '  trg_auth_users__create_profile trigger did not fire. Check migrations 0002 and 0023.',
      )
      process.exit(1)
    }
    console.log('✓ app_user profile present')

    const roleRow = await sql<{ id: string }[]>`
      select id from public.role where code = ${role}
    `
    if (roleRow.length === 0 || !roleRow[0]) {
      console.error(`✖ No role with code ${role}. Has the seed run?`)
      process.exit(1)
    }

    // user_role carries an audit trigger, and fn_current_actor_id refuses a write it cannot
    // attribute. This connection is a bare one — it never passes through
    // withAuthenticatedDb() — so the actor has to be set explicitly. Transaction-scoped
    // (`true`), so it cannot leak into anything else on this connection.
    await sql.begin(async (tx) => {
      await tx`select set_config('app.actor_id', ${userId}, true)`

      await tx`
        insert into public.user_role (user_id, role_id, assigned_by)
        values (${userId}, ${roleRow[0]!.id}, ${userId})
        on conflict do nothing
      `

      // Permission AND scope are both required, always — see isWithinScope() in
      // @modules/identity. A user with all 85 permissions and no scope row is refused
      // every operation that names a branch, warehouse or room, because
      // `supplied.every(...)` finds nothing to match against. That reads as a baffling
      // permission bug, so the bootstrap account gets global scope explicitly.
      await tx`
        insert into public.user_scope (id, user_id, scope_kind, scope_id, created_by)
        select gen_random_uuid(), ${userId}, 'global', null, ${userId}
        where not exists (
          select 1 from public.user_scope
          where user_id = ${userId} and scope_kind = 'global'
        )
      `
    })
    console.log(`✓ role granted — ${role}`)
    console.log('✓ global scope granted')

    console.log(
      [
        '',
        'Done. Sign in at /login with the password you supplied.',
        'You will be sent straight to /first-login to change it — that is by design,',
        'and nothing else renders until you do.',
        '',
        'NOTE: this only works once the Custom Access Token hook is enabled in the',
        'dashboard (Authentication → Hooks). Without it the JWT carries no actor_kind',
        'and the proxy cannot tell staff from customers.',
        '',
      ].join('\n'),
    )
  } finally {
    await sql.end()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})

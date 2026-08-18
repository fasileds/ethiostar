import { sql } from 'drizzle-orm'
import { demoId } from './util'
import type { SeedContext } from '../types'

/**
 * Demo staff and portal users.
 *
 * `app_user` carries a hard FK to `auth.users(id)` (GoTrue owns identity — see
 * db/schema/identity.ts). The seed runs as the bare Postgres connection owner, not through
 * the Supabase Admin API, so it inserts into `auth.users` directly and lets
 * `trg_auth_users__create_profile` (migration 0002) create the matching `app_user` row —
 * exactly the mechanism `scripts/create-admin.ts` documents, just via SQL instead of the
 * REST admin endpoint. Duplicating that trigger's insert here would be the drift bug the
 * trigger exists to prevent.
 *
 * Every demo account shares the password `Demo12345!` (bcrypt-hashed via pgcrypto) purely
 * so a reviewer can sign in and look around; `must_change_password` is left false so the
 * login isn't gated by the first-login flow that a real handover credential is.
 */

const DEMO_PASSWORD_HASH_SQL = sql`extensions.crypt('Demo12345!', extensions.gen_salt('bf'))`

export interface DemoUser {
  seed: string
  email: string
  fullName: string
  roleCode: string
  jobTitle: string
  actorKind: 'staff' | 'customer'
  customerSeed?: string
  scope: 'global' | 'branch'
}

export const DEMO_STAFF_USERS: readonly DemoUser[] = [
  {
    seed: 'user:admin',
    email: 'admin.demo@ethiostar.et',
    fullName: 'Selamawit Girma',
    roleCode: 'SYSTEM_ADMINISTRATOR',
    jobTitle: 'System Administrator',
    actorKind: 'staff',
    scope: 'global',
  },
  {
    seed: 'user:gm',
    email: 'gm.demo@ethiostar.et',
    fullName: 'Dawit Alemayehu',
    roleCode: 'GENERAL_MANAGER',
    jobTitle: 'General Manager',
    actorKind: 'staff',
    scope: 'global',
  },
  {
    seed: 'user:ops-manager',
    email: 'ops.demo@ethiostar.et',
    fullName: 'Meron Tesfaye',
    roleCode: 'OPERATIONS_MANAGER',
    jobTitle: 'Operations Manager',
    actorKind: 'staff',
    scope: 'global',
  },
  {
    seed: 'user:cso',
    email: 'cso.demo@ethiostar.et',
    fullName: 'Bethlehem Assefa',
    roleCode: 'CUSTOMER_SERVICE_OFFICER',
    jobTitle: 'Customer Service Officer',
    actorKind: 'staff',
    scope: 'branch',
  },
  {
    seed: 'user:store-keeper',
    email: 'storekeeper.demo@ethiostar.et',
    fullName: 'Yonas Kebede',
    roleCode: 'STORE_KEEPER',
    jobTitle: 'Store Keeper',
    actorKind: 'staff',
    scope: 'branch',
  },
  {
    seed: 'user:store-manager',
    email: 'storemanager.demo@ethiostar.et',
    fullName: 'Hana Wolde',
    roleCode: 'STORE_MANAGER',
    jobTitle: 'Store Manager',
    actorKind: 'staff',
    scope: 'branch',
  },
  {
    seed: 'user:production-operator',
    email: 'production.demo@ethiostar.et',
    fullName: 'Samuel Tadesse',
    roleCode: 'PRODUCTION_OPERATOR',
    jobTitle: 'Production Operator',
    actorKind: 'staff',
    scope: 'branch',
  },
  {
    seed: 'user:finance-officer',
    email: 'finance.demo@ethiostar.et',
    fullName: 'Rahel Mulugeta',
    roleCode: 'FINANCE_OFFICER',
    jobTitle: 'Finance Officer',
    actorKind: 'staff',
    scope: 'global',
  },
  {
    seed: 'user:labour-coordinator',
    email: 'labour.demo@ethiostar.et',
    fullName: 'Girma Fikru',
    roleCode: 'LABOUR_COORDINATOR',
    jobTitle: 'Labour Coordinator',
    actorKind: 'staff',
    scope: 'branch',
  },
  {
    seed: 'user:gate-officer',
    email: 'gate.demo@ethiostar.et',
    fullName: 'Abebe Worku',
    roleCode: 'SECURITY_GATE_OFFICER',
    jobTitle: 'Security / Gate Officer',
    actorKind: 'staff',
    scope: 'branch',
  },
  {
    seed: 'user:auditor',
    email: 'auditor.demo@ethiostar.et',
    fullName: 'Tigist Haile',
    roleCode: 'AUDITOR',
    jobTitle: 'Internal Auditor',
    actorKind: 'staff',
    scope: 'global',
  },
  // A second store keeper, SUSPENDED — exercises the app_user status filter and the
  // "why can't I log in" support path.
  {
    seed: 'user:store-keeper-2',
    email: 'storekeeper2.demo@ethiostar.et',
    fullName: 'Kalkidan Negash',
    roleCode: 'STORE_KEEPER',
    jobTitle: 'Store Keeper (Bole)',
    actorKind: 'staff',
    scope: 'branch',
  },
]

/** Portal users — one per a handful of customers, tying `actorKind: 'customer'` to a
 *  `customer_id`. See {@link DemoUser.customerSeed}, resolved in 020-customers.ts's seed. */
export const DEMO_PORTAL_USERS: readonly DemoUser[] = [
  {
    seed: 'user:portal-abyssinia',
    email: 'portal.abyssinia@example.com',
    fullName: 'Meseret Alemu',
    roleCode: 'CUSTOMER',
    jobTitle: 'Export Coordinator',
    actorKind: 'customer',
    customerSeed: 'customer:abyssinia-highland',
    scope: 'global',
  },
  {
    seed: 'user:portal-oromia-union',
    email: 'portal.oromia@example.com',
    fullName: 'Tariku Bulcha',
    roleCode: 'CUSTOMER',
    jobTitle: 'Union Secretary',
    actorKind: 'customer',
    customerSeed: 'customer:oromia-coffee-union',
    scope: 'global',
  },
  {
    seed: 'user:portal-kaffa',
    email: 'portal.kaffa@example.com',
    fullName: 'Genet Shiferaw',
    roleCode: 'CUSTOMER',
    jobTitle: 'Trading Manager',
    actorKind: 'customer',
    customerSeed: 'customer:kaffa-forest-trading',
    scope: 'global',
  },
]

export interface IdentityRefs {
  userIdBySeed: Map<string, string>
}

async function upsertAuthUser(
  ctx: SeedContext,
  user: DemoUser,
  customerId: string | null,
): Promise<string> {
  const id = demoId(user.seed)
  const metadata = {
    full_name: user.fullName,
    actor_kind: user.actorKind,
    customer_id: customerId,
    must_change_password: false,
    preferred_locale: 'en',
    created_by: id,
  }

  await ctx.tx.execute(sql`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated',
      ${user.email}, ${DEMO_PASSWORD_HASH_SQL}, now(),
      '{"provider":"email","providers":["email"]}'::jsonb, ${JSON.stringify(metadata)}::jsonb,
      now(), now(), '', '', '', '', false, false
    )
    on conflict (id) do nothing
  `)

  return id
}

export async function seedIdentity(ctx: SeedContext, branchId: string): Promise<IdentityRefs> {
  const { log } = ctx
  const userIdBySeed = new Map<string, string>()

  for (const user of DEMO_STAFF_USERS) {
    const id = await upsertAuthUser(ctx, user, null)
    userIdBySeed.set(user.seed, id)

    const roleRow = (await ctx.tx.execute(
      sql`select id from public.role where code = ${user.roleCode}`,
    )) as unknown as Array<{ id: string }>
    const roleId = roleRow[0]?.id
    if (!roleId) throw new Error(`Role ${user.roleCode} not found — did 010-permissions run?`)

    // `trg_auth_users__create_profile` (fired by upsertAuthUser's insert into auth.users,
    // above) has already created this app_user row — job_title is the only column this
    // seed still needs to set on it. A plain UPDATE, not an upsert: `INSERT ... ON
    // CONFLICT DO UPDATE` validates NOT NULL constraints against the candidate row
    // (id, job_title, NULL for every omitted column) BEFORE it discovers the conflict and
    // switches to the UPDATE branch, so an insert column list that omits app_user's other
    // NOT NULL columns (actor_kind, email, full_name, created_by) fails even though the
    // row already exists and would only ever be updated.
    await ctx.tx.execute(sql`
      update public.app_user set job_title = ${user.jobTitle} where id = ${id}
    `)

    await ctx.tx.execute(sql`
      insert into public.user_role (user_id, role_id, assigned_by)
      values (${id}, ${roleId}, ${id})
      on conflict do nothing
    `)

    const scopeId = demoId(`user_scope:${user.seed}`)
    await ctx.tx.execute(sql`
      insert into public.user_scope (id, user_id, scope_kind, scope_id, created_by)
      values (
        ${scopeId}, ${id}, ${user.scope},
        ${user.scope === 'global' ? null : branchId},
        ${id}
      )
      on conflict (user_id, scope_kind, scope_id) do nothing
    `)
  }

  // One staff account is SUSPENDED, so the app_user status filter has something to show.
  const suspendedId = userIdBySeed.get('user:store-keeper-2')
  if (suspendedId) {
    await ctx.tx.execute(sql`
      update public.app_user
      set status = 'SUSPENDED', suspended_at = now(), suspended_reason = 'Extended unpaid leave'
      where id = ${suspendedId} and status <> 'SUSPENDED'
    `)
  }

  log(`staff users: ${DEMO_STAFF_USERS.length} (1 suspended), each granted their named role`)

  return { userIdBySeed }
}

/** Called from 020-customers.ts once customer ids exist. */
export async function seedPortalUsers(
  ctx: SeedContext,
  customerIdBySeed: Map<string, string>,
): Promise<Map<string, string>> {
  const userIdBySeed = new Map<string, string>()

  for (const user of DEMO_PORTAL_USERS) {
    const customerId = user.customerSeed ? customerIdBySeed.get(user.customerSeed) : undefined
    if (!customerId) continue

    const id = await upsertAuthUser(ctx, user, customerId)
    userIdBySeed.set(user.seed, id)

    const roleRow = (await ctx.tx.execute(
      sql`select id from public.role where code = ${user.roleCode}`,
    )) as unknown as Array<{ id: string }>
    const roleId = roleRow[0]?.id
    if (!roleId) throw new Error(`Role ${user.roleCode} not found`)

    await ctx.tx.execute(sql`
      insert into public.user_role (user_id, role_id, assigned_by)
      values (${id}, ${roleId}, ${id})
      on conflict do nothing
    `)
  }

  ctx.log(`portal users: ${userIdBySeed.size}`)
  return userIdBySeed
}

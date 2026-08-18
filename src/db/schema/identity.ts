import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  index,
  uniqueIndex,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { instant, auditColumns, activeFlag, displayNames } from '../helpers/columns'

/**
 * M01 — Identity, Access & Role Management.
 *
 * GoTrue (Supabase Auth) owns identity: auth.users, auth.sessions, auth.refresh_tokens,
 * auth.mfa_factors, invitations. We do NOT shadow any of them — a second copy that must
 * never disagree is a defect generator. See docs/adr/0014-supabase-auth.md.
 *
 * What lives here is the DOMAIN half: the profile, the RBAC model, and the data scoping
 * that lets a store keeper of Room A be refused a movement in Room B.
 *
 * The permission CATALOGUE lives in code (db/seeds/010-permissions.ts) and is synced on
 * every deploy; the role → permission MAPPING lives here and is administrator-editable
 * (M23). That split means a new permission can never be missing in production, while
 * who-can-do-what stays configurable without a release.
 */

// ── Profile ──────────────────────────────────────────────────────────────────

export const appUser = pgTable(
  'app_user',
  {
    /**
     * FK to auth.users(id). Declared in SQL rather than here because Drizzle does not model
     * the auth schema — and we must never add columns to auth.users, which Supabase
     * upgrades underneath us.
     */
    id: uuid('id').primaryKey(),

    /** Realm. Surfaces as the `actor_kind` JWT claim and drives RLS policy selection. */
    actorKind: text('actor_kind').notNull(),

    /** Null for staff; set for portal users. Becomes the `customer_id` claim. */
    customerId: uuid('customer_id'),

    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    employeeNumber: text('employee_number'),
    jobTitle: text('job_title'),

    /**
     * ACTIVE | SUSPENDED | LOCKED | DORMANT.
     * Re-read by requireActor() on every request — this is what makes revocation
     * effectively immediate despite a self-contained JWT. See docs/adr/0014 §revocation.
     */
    status: text('status').notNull().default('ACTIVE'),

    /**
     * M04 Stage-1 requirement: credentials issued on customer approval force a change at
     * first login. Surfaced as a JWT claim so proxy.ts can redirect without a DB call, and
     * re-checked in every use case except change-password.
     */
    mustChangePassword: boolean('must_change_password').notNull().default(false),

    /** Bumped when any of this user's roles change; forces a token refresh. */
    permissionsVersion: integer('permissions_version').notNull().default(1),

    /** Mandatory for admin, GM, finance and any role holding stock:adjust. */
    mfaRequired: boolean('mfa_required').notNull().default(false),

    lastSeenAt: instant('last_seen_at'),
    suspendedAt: instant('suspended_at'),
    suspendedReason: text('suspended_reason'),
    preferredLocale: text('preferred_locale').notNull().default('en'),

    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_app_user__email').on(t.email),
    index('idx_app_user__customer')
      .on(t.customerId)
      .where(sql`${t.customerId} is not null`),
    index('idx_app_user__status').on(t.status),
    // Dormant-account review (governance report, client document §7.2).
    index('idx_app_user__last_seen').on(t.lastSeenAt),
    check('ck_app_user__actor_kind', sql`${t.actorKind} in ('staff','customer')`),
    check('ck_app_user__status', sql`${t.status} in ('ACTIVE','SUSPENDED','LOCKED','DORMANT')`),
    check('ck_app_user__locale', sql`${t.preferredLocale} in ('en','am')`),
    // A customer user must be bound to a customer; a staff user must not be.
    check(
      'ck_app_user__customer_binding',
      sql`(${t.actorKind} = 'customer' and ${t.customerId} is not null)
          or (${t.actorKind} = 'staff' and ${t.customerId} is null)`,
    ),
  ],
)

/**
 * Password history. GoTrue hashes and stores the CURRENT password; it does not keep a
 * history, so reuse prevention is ours.
 */
export const userPasswordHistory = pgTable(
  'user_password_history',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    passwordHash: text('password_hash').notNull(),
    changedAt: instant('changed_at')
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index('idx_user_password_history__user').on(t.userId, t.changedAt.desc())],
)

/**
 * Every authentication attempt, success and failure.
 *
 * GoTrue rate-limits and logs internally, but its logs are not queryable as an audit record
 * and are not retained on our terms. The governance report list in the client document
 * asks for user-access review, which needs this.
 */
export const userLoginAttempt = pgTable(
  'user_login_attempt',
  {
    id: uuid('id').primaryKey(),
    /** Nullable: a failed attempt may be for an address with no account. */
    userId: uuid('user_id').references(() => appUser.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    succeeded: boolean('succeeded').notNull(),
    failureReason: text('failure_reason'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    attemptedAt: instant('attempted_at')
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('idx_user_login_attempt__email').on(t.email, t.attemptedAt.desc()),
    index('idx_user_login_attempt__user').on(t.userId, t.attemptedAt.desc()),
    // Lockout counts failures in a window; the partial index keeps that query cheap.
    index('idx_user_login_attempt__failures')
      .on(t.email, t.attemptedAt.desc())
      .where(sql`${t.succeeded} = false`),
  ],
)

// ── RBAC ─────────────────────────────────────────────────────────────────────

export const permission = pgTable(
  'permission',
  {
    id: uuid('id').primaryKey(),
    /** `<resource>:<action>` — the client document's own definition of a permission. */
    code: text('code').notNull(),
    resource: text('resource').notNull(),
    action: text('action').notNull(),
    description: text('description').notNull(),
    /** Grouping for the admin UI only; carries no authorization meaning. */
    groupCode: text('group_code').notNull(),
    /** True for read-only actions — used to assert the Auditor role holds no writes. */
    isReadOnly: boolean('is_read_only').notNull().default(false),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_permission__code').on(t.code),
    index('idx_permission__group').on(t.groupCode),
    check('ck_permission__code_shape', sql`${t.code} ~ '^[a-z_]+:[a-z_]+$'`),
  ],
)

export const role = pgTable(
  'role',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    ...displayNames(),
    description: text('description'),
    /** System roles are seeded and cannot be deleted; their permissions remain editable. */
    isSystem: boolean('is_system').notNull().default(false),
    /** Roles that can move stock or release coffee must carry MFA. */
    requiresMfa: boolean('requires_mfa').notNull().default(false),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [uniqueIndex('uq_role__code').on(t.code)],
)

export const rolePermission = pgTable(
  'role_permission',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permission.id, { onDelete: 'cascade' }),
    grantedAt: instant('granted_at')
      .notNull()
      .default(sql`now()`),
    grantedBy: uuid('granted_by'),
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    index('idx_role_permission__permission').on(t.permissionId),
  ],
)

export const userRole = pgTable(
  'user_role',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'restrict' }),
    assignedAt: instant('assigned_at')
      .notNull()
      .default(sql`now()`),
    assignedBy: uuid('assigned_by').notNull(),
    /** Temporary elevation (cover during leave) expires without an administrator remembering. */
    expiresAt: instant('expires_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index('idx_user_role__role').on(t.roleId),
    index('idx_user_role__expiring')
      .on(t.expiresAt)
      .where(sql`${t.expiresAt} is not null`),
  ],
)

/**
 * Data scoping — the second, orthogonal dimension of authorization.
 *
 * "a store keeper of Room A cannot post movements in Room B."
 *
 * A user may hold several scope rows; the effective scope is their union. A user with no
 * scope row of a given kind is unrestricted on that axis only if they hold a `global` row —
 * absence is NOT permission.
 */
export const userScope = pgTable(
  'user_scope',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
    /** global | branch | warehouse | room */
    scopeKind: text('scope_kind').notNull(),
    /** Null when scopeKind = 'global'. */
    scopeId: uuid('scope_id'),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_user_scope__user_kind_target').on(t.userId, t.scopeKind, t.scopeId),
    index('idx_user_scope__user').on(t.userId),
    check('ck_user_scope__kind', sql`${t.scopeKind} in ('global','branch','warehouse','room')`),
    check(
      'ck_user_scope__target',
      sql`(${t.scopeKind} = 'global' and ${t.scopeId} is null)
          or (${t.scopeKind} <> 'global' and ${t.scopeId} is not null)`,
    ),
  ],
)

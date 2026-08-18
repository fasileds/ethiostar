import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { provisionAuthUser } from '../infrastructure/system/provision-auth-user'
import {
  assignRole,
  addUserScope,
  type AddScopeInput,
} from '../infrastructure/identity.repository'

/**
 * Provision a staff account: a GoTrue user with no password, the requested role, and
 * optional scope rows — one call, so a caller cannot create a login and forget the role
 * that makes it useful.
 *
 * TWO PHASES, like `files.uploadFile`: `provisionAuthUser` is network I/O against the
 * Supabase Admin API and must not run inside a transaction (docs/architecture/06 §6.3 rule
 * 3); the role and scope writes that follow are DB-only and get their own transaction.
 *
 * Split from onboarding's customer path (`onboarding.approveApplication`) even though both
 * end in `provisionAuthUser`, because the two differ in everything downstream: a customer
 * is bound to a customer record and the CUSTOMER role by convention; a staff account is
 * bound to nothing and its role is an administrator's explicit choice.
 */
export interface CreateStaffUserInput {
  readonly email: string
  readonly fullName: string
  readonly roleCode: string
  readonly scopes?: readonly Omit<AddScopeInput, 'userId'>[]
  readonly createdBy: string
  readonly preferredLocale?: 'en' | 'am'
}

export interface CreatedStaffUser {
  readonly userId: string
  readonly actionLink: string
}

export async function createStaffUser(
  claims: DbClaims,
  input: CreateStaffUserInput,
): Promise<CreatedStaffUser> {
  const provisioned = await provisionAuthUser({
    email: input.email,
    fullName: input.fullName,
    actorKind: 'staff',
    customerId: null,
    createdBy: input.createdBy,
    redirectPath: '/first-login',
    ...(input.preferredLocale ? { preferredLocale: input.preferredLocale } : {}),
  })

  await runInTransaction(claims, async (tx) => {
    await assignRole(tx, {
      userId: provisioned.userId,
      roleCode: input.roleCode,
      assignedBy: input.createdBy,
    })

    for (const scope of input.scopes ?? []) {
      await addUserScope(tx, { ...scope, userId: provisioned.userId })
    }
  })

  return provisioned
}

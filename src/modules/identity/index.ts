/**
 * M01 — Identity, Access & Role Management.
 *
 * The PUBLIC API of this module. Other modules import only from here; deep imports are
 * rejected by ESLint and dependency-cruiser, so refactoring inside the module cannot break
 * another one.
 */

export {
  type Actor,
  type ScopeKind,
  type ScopeEntry,
  type ScopeTarget,
  isStaff,
  isCustomer,
  isActive,
  hasPermission,
  hasAnyPermission,
  hasGlobalScope,
  isWithinScope,
  scopeIdsOfKind,
  systemActor,
  SYSTEM_ACTOR_ID,
} from './domain/actor'

export {
  PERMISSIONS,
  PERMISSION_CODES,
  READ_ONLY_PERMISSIONS,
  isKnownPermission,
  type PermissionDefinition,
  type PermissionCode,
} from './domain/permissions'

export {
  ROLES,
  ROLE_CODES,
  permissionsForRole,
  type RoleCode,
  type RoleDefinition,
} from './domain/roles'

export {
  assignRole,
  revokeRole,
  addUserScope,
  removeUserScope,
  suspendUser,
  reactivateUser,
  setMfaRequired,
  type AssignRoleInput,
  type AddScopeInput,
} from './infrastructure/identity.repository'

export {
  provisionAuthUser,
  type ProvisionAuthUserInput,
  type ProvisionedAuthUser,
} from './infrastructure/system/provision-auth-user'

export {
  createStaffUser,
  type CreateStaffUserInput,
  type CreatedStaffUser,
} from './application/create-staff-user'

export { listStaffUsers, type StaffUserRow } from './application/user.query'

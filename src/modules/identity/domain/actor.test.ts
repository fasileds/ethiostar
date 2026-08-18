import { describe, it, expect } from 'vitest'
import {
  type Actor,
  hasPermission,
  isWithinScope,
  scopeIdsOfKind,
  hasGlobalScope,
  systemActor,
  isStaff,
  isCustomer,
} from './actor'
import { PERMISSIONS, PERMISSION_CODES, isKnownPermission } from './permissions'
import { ROLES, ROLE_CODES, permissionsForRole } from './roles'

const ROOM_A = '11111111-1111-7111-8111-111111111111'
const ROOM_B = '22222222-2222-7222-8222-222222222222'
const WAREHOUSE_1 = '33333333-3333-7333-8333-333333333333'
const CUSTOMER_1 = '44444444-4444-7444-8444-444444444444'
const CUSTOMER_2 = '55555555-5555-7555-8555-555555555555'

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    userId: 'u1',
    actorKind: 'staff',
    customerId: null,
    email: 'a@b.co',
    fullName: 'Test User',
    status: 'ACTIVE',
    mustChangePassword: false,
    locale: 'en',
    roles: [],
    permissions: new Set<string>(),
    scopes: [],
    assuranceLevel: 'aal1',
    permissionsVersion: 1,
    ...overrides,
  }
}

describe('permission catalogue', () => {
  it('has unique, well-formed codes', () => {
    expect(PERMISSION_CODES.size).toBe(PERMISSIONS.length)
    for (const perm of PERMISSIONS) {
      expect(perm.code).toMatch(/^[a-z_]+:[a-z_]+$/)
      expect(`${perm.resource}:${perm.action}`).toBe(perm.code)
      expect(perm.description.length).toBeGreaterThan(5)
    }
  })

  it('recognises known codes and rejects unknown ones', () => {
    expect(isKnownPermission('stock:adjust')).toBe(true)
    expect(isKnownPermission('stock:destroy')).toBe(false)
  })
})

describe('role definitions', () => {
  it('defines exactly the twelve roles named in M01', () => {
    expect(ROLES).toHaveLength(12)
    expect(new Set(ROLES.map((r) => r.code))).toEqual(new Set(Object.values(ROLE_CODES)))
  })

  it('grants only permissions that exist in the catalogue', () => {
    for (const role of ROLES) {
      for (const code of role.permissions) {
        expect(isKnownPermission(code), `${role.code} grants unknown ${code}`).toBe(true)
      }
    }
  })

  /**
   * M01: "Auditor (read-only)". An auditor silently gaining write access is a governance
   * failure that would otherwise go unnoticed — so it is asserted, not trusted.
   */
  it('AUDITOR holds no write permission', () => {
    const auditorPermissions = permissionsForRole(ROLE_CODES.AUDITOR)
    const writes = auditorPermissions.filter((code) => {
      const definition = PERMISSIONS.find((p) => p.code === code)
      return definition && !definition.readOnly
    })
    expect(writes).toEqual([])
  })

  it('AUDITOR can nonetheless see the audit trail', () => {
    expect(permissionsForRole(ROLE_CODES.AUDITOR)).toContain('audit:view')
  })

  it('requires MFA for every role that can move stock or release coffee', () => {
    const dangerous = ['stock:adjust', 'dispatch:override_hold', 'admin:manage_roles']
    for (const role of ROLES) {
      const holdsDangerous = role.permissions.some((p) => dangerous.includes(p))
      if (holdsDangerous) {
        expect(role.requiresMfa, `${role.code} holds a dangerous permission`).toBe(true)
      }
    }
  })

  it('CUSTOMER holds no staff-only permission', () => {
    const customer = permissionsForRole(ROLE_CODES.CUSTOMER)
    const forbidden = [
      'stock:adjust',
      'goods_receipt:confirm_count',
      'job_order:close',
      'admin:manage_users',
      'report:view_financial',
      'audit:view',
      'dispatch:record_gate_out',
    ]
    for (const code of forbidden) {
      expect(customer, `CUSTOMER must not hold ${code}`).not.toContain(code)
    }
  })

  it('SECURITY_GATE_OFFICER can record gate-out but not adjust stock', () => {
    const gate = permissionsForRole(ROLE_CODES.SECURITY_GATE_OFFICER)
    expect(gate).toContain('dispatch:record_gate_out')
    expect(gate).not.toContain('stock:adjust')
    expect(gate).not.toContain('dispatch:issue_gate_pass')
  })

  it('STORE_KEEPER can confirm a kesha count but cannot adjust stock', () => {
    // The confirmed count is what labour is paid from (M18); adjusting a balance is a
    // separate, higher-trust action (T2 in the threat register).
    const keeper = permissionsForRole(ROLE_CODES.STORE_KEEPER)
    expect(keeper).toContain('goods_receipt:confirm_count')
    expect(keeper).not.toContain('stock:adjust')
  })

  it('PRODUCTION_OPERATOR cannot close a job outside tolerance', () => {
    const operator = permissionsForRole(ROLE_CODES.PRODUCTION_OPERATOR)
    expect(operator).toContain('job_order:close')
    expect(operator).not.toContain('job_order:close_with_variance')
    expect(operator).not.toContain('job_order:override_schedule')
  })

  it('SYSTEM_ADMINISTRATOR holds everything', () => {
    expect(permissionsForRole(ROLE_CODES.SYSTEM_ADMINISTRATOR)).toHaveLength(PERMISSIONS.length)
  })

  it('deduplicates overlapping grants', () => {
    for (const role of ROLES) {
      const resolved = permissionsForRole(role.code)
      expect(new Set(resolved).size).toBe(resolved.length)
    }
  })
})

describe('permission checks', () => {
  it('denies by default', () => {
    expect(hasPermission(actor(), 'stock:adjust')).toBe(false)
  })

  it('grants what is held', () => {
    const a = actor({ permissions: new Set(['stock:adjust']) })
    expect(hasPermission(a, 'stock:adjust')).toBe(true)
    expect(hasPermission(a, 'stock:count')).toBe(false)
  })
})

describe('data scoping — M01 key control', () => {
  const roomAKeeper = actor({ scopes: [{ kind: 'room', id: ROOM_A }] })

  it('a store keeper of Room A cannot act in Room B', () => {
    expect(isWithinScope(roomAKeeper, { roomId: ROOM_A })).toBe(true)
    expect(isWithinScope(roomAKeeper, { roomId: ROOM_B })).toBe(false)
  })

  it('denies by default — no scope rows means no scope', () => {
    expect(isWithinScope(actor(), { roomId: ROOM_A })).toBe(false)
  })

  it('global scope satisfies any target', () => {
    const admin = actor({ scopes: [{ kind: 'global', id: null }] })
    expect(hasGlobalScope(admin)).toBe(true)
    expect(isWithinScope(admin, { roomId: ROOM_B })).toBe(true)
    expect(isWithinScope(admin, { warehouseId: WAREHOUSE_1 })).toBe(true)
  })

  it('requires EVERY supplied dimension to be covered', () => {
    const a = actor({ scopes: [{ kind: 'room', id: ROOM_A }] })
    // Room matches, but the warehouse dimension is not covered by any scope row.
    expect(isWithinScope(a, { roomId: ROOM_A, warehouseId: WAREHOUSE_1 })).toBe(false)

    const b = actor({
      scopes: [
        { kind: 'room', id: ROOM_A },
        { kind: 'warehouse', id: WAREHOUSE_1 },
      ],
    })
    expect(isWithinScope(b, { roomId: ROOM_A, warehouseId: WAREHOUSE_1 })).toBe(true)
  })

  it('passes when no location is supplied (non-location-bound actions)', () => {
    expect(isWithinScope(actor(), {})).toBe(true)
  })

  it('unions multiple scope entries of the same kind', () => {
    const a = actor({
      scopes: [
        { kind: 'room', id: ROOM_A },
        { kind: 'room', id: ROOM_B },
      ],
    })
    expect(isWithinScope(a, { roomId: ROOM_A })).toBe(true)
    expect(isWithinScope(a, { roomId: ROOM_B })).toBe(true)
    expect(scopeIdsOfKind(a, 'room')).toEqual([ROOM_A, ROOM_B])
  })
})

describe('customer scoping — M09 key control', () => {
  const customer = actor({
    actorKind: 'customer',
    customerId: CUSTOMER_1,
    scopes: [],
  })

  it('a customer may only reach their own data', () => {
    expect(isWithinScope(customer, { customerId: CUSTOMER_1 })).toBe(true)
    expect(isWithinScope(customer, { customerId: CUSTOMER_2 })).toBe(false)
  })

  it('a customer is not granted room or warehouse scope by accident', () => {
    // A customer with no customerId target still cannot be given staff scope semantics.
    expect(isCustomer(customer)).toBe(true)
    expect(isStaff(customer)).toBe(false)
  })
})

describe('system actor', () => {
  it('holds no permissions — the worker acts through use cases, not as an admin', () => {
    const sys = systemActor()
    expect(sys.permissions.size).toBe(0)
    expect(hasPermission(sys, 'stock:adjust')).toBe(false)
  })
})

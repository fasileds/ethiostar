import { PERMISSIONS, READ_ONLY_PERMISSIONS, type PermissionDefinition } from './permissions'

/**
 * The twelve EthioStar roles, named in M01.
 *
 * These are DEFAULTS, seeded on first deploy. EthioStar adjusts the mapping in the admin
 * console (M23) without a release — which is why the mapping lives in the database while
 * the catalogue lives in code.
 */

export const ROLE_CODES = {
  SYSTEM_ADMINISTRATOR: 'SYSTEM_ADMINISTRATOR',
  GENERAL_MANAGER: 'GENERAL_MANAGER',
  OPERATIONS_MANAGER: 'OPERATIONS_MANAGER',
  CUSTOMER_SERVICE_OFFICER: 'CUSTOMER_SERVICE_OFFICER',
  STORE_KEEPER: 'STORE_KEEPER',
  STORE_MANAGER: 'STORE_MANAGER',
  PRODUCTION_OPERATOR: 'PRODUCTION_OPERATOR',
  FINANCE_OFFICER: 'FINANCE_OFFICER',
  LABOUR_COORDINATOR: 'LABOUR_COORDINATOR',
  SECURITY_GATE_OFFICER: 'SECURITY_GATE_OFFICER',
  AUDITOR: 'AUDITOR',
  CUSTOMER: 'CUSTOMER',
} as const

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES]

export interface RoleDefinition {
  readonly code: RoleCode
  readonly nameEn: string
  readonly nameAm: string
  readonly description: string
  /** Roles that can move stock or release coffee must carry MFA. */
  readonly requiresMfa: boolean
  readonly permissions: readonly string[]
}

const ALL = PERMISSIONS.map((perm: PermissionDefinition) => perm.code)

/** Every permission in a group. */
const group = (...groups: string[]): string[] =>
  PERMISSIONS.filter((perm) => groups.includes(perm.group)).map((perm) => perm.code)

/** Every read-only permission in a group. */
const readOnly = (...groups: string[]): string[] =>
  PERMISSIONS.filter((perm) => groups.includes(perm.group) && perm.readOnly).map((p) => p.code)

export const ROLES: readonly RoleDefinition[] = [
  {
    code: ROLE_CODES.SYSTEM_ADMINISTRATOR,
    nameEn: 'System Administrator',
    nameAm: 'የሲስተም አስተዳዳሪ',
    description: 'Full system access. Configuration, users and roles.',
    requiresMfa: true,
    permissions: ALL,
  },
  {
    code: ROLE_CODES.GENERAL_MANAGER,
    nameEn: 'General Manager',
    nameAm: 'ዋና ሥራ አስኪያጅ',
    description: 'Full visibility across operations and commerce; approves exceptions.',
    requiresMfa: true,
    permissions: [
      ...readOnly(
        'onboarding',
        'customer',
        'inbound',
        'stock',
        'warehouse',
        'kesha',
        'scheduling',
        'processing',
        'acceptance',
        'dispatch',
        'labour',
        'audit',
        'master_data',
      ),
      ...group('report'),
      'customer_application:approve',
      'delivery_request:approve',
      'delivery_request:approve_high_value',
      'job_order:close_with_variance',
      'stock:approve_count_variance',
      'dispatch:override_hold',
      'labour:approve_earnings',
      'admin:manage_settings',
    ],
  },
  {
    code: ROLE_CODES.OPERATIONS_MANAGER,
    nameEn: 'Operations Manager',
    nameAm: 'የሥራ ክንውን ሥራ አስኪያጅ',
    description: 'Owns the operational chain from receiving through dispatch.',
    requiresMfa: false,
    permissions: [
      ...group('inbound', 'scheduling', 'processing', 'acceptance', 'dispatch', 'warehouse'),
      ...readOnly('customer', 'stock', 'kesha', 'labour', 'audit', 'master_data'),
      'report:view_operational',
      'report:export',
      'document:print',
      'document:reprint',
      'label:print',
      'stock:approve_count_variance',
    ].filter((code) => code !== 'dispatch:override_hold'),
  },
  {
    code: ROLE_CODES.CUSTOMER_SERVICE_OFFICER,
    nameEn: 'Customer Service Officer',
    nameAm: 'የደንበኞች አገልግሎት ኦፊሰር',
    description: 'Onboarding, customer records and first-line requests.',
    requiresMfa: false,
    permissions: [
      ...group('onboarding', 'customer'),
      ...readOnly('inbound', 'scheduling', 'processing', 'acceptance', 'dispatch', 'stock'),
      'delivery_request:create',
      'delivery_request:approve',
      'processing_request:create',
      'document:print',
      'report:view_operational',
      'support_ticket:view',
      'support_ticket:manage',
    ],
  },
  {
    code: ROLE_CODES.STORE_KEEPER,
    nameEn: 'Store Keeper',
    nameAm: 'የመጋዘን ኃላፊ',
    description:
      'Records what was physically received and where it was put. Scoped to their rooms.',
    requiresMfa: false,
    permissions: [
      'goods_receipt:view',
      'goods_receipt:create',
      'goods_receipt:record_weight',
      'goods_receipt:witness_weight',
      'goods_receipt:confirm_count',
      'store_placement:create',
      'store_placement:transfer',
      'stock:view',
      'stock:count',
      'warehouse:view',
      'kesha:view',
      'kesha:manage_empty_stock',
      'delivery_request:view',
      'document:print',
      'label:print',
    ],
  },
  {
    code: ROLE_CODES.STORE_MANAGER,
    nameEn: 'Store Manager',
    nameAm: 'የመጋዘን ሥራ አስኪያጅ',
    description: 'Owns capacity, ageing and stock integrity.',
    requiresMfa: true,
    permissions: [
      ...group('warehouse', 'kesha'),
      ...group('stock'),
      'goods_receipt:view',
      'store_placement:create',
      'store_placement:transfer',
      'delivery_request:view',
      'document:print',
      'document:reprint',
      'label:print',
      'report:view_operational',
      'report:export',
      'audit:view',
    ],
  },
  {
    code: ROLE_CODES.PRODUCTION_OPERATOR,
    nameEn: 'Production Operator',
    nameAm: 'የምርት ኦፕሬተር',
    description: 'Runs jobs on the line and records the four outputs.',
    requiresMfa: false,
    permissions: [
      'job_order:view',
      'job_order:accept',
      'job_order:start',
      'job_order:record_output',
      'job_order:close',
      'appointment:view',
      'stock:view',
      'warehouse:view',
      'kesha:view',
      'document:print',
      'label:print',
    ],
  },
  {
    code: ROLE_CODES.FINANCE_OFFICER,
    nameEn: 'Finance Officer',
    nameAm: 'የፋይናንስ ኦፊሰር',
    description:
      'Financial oversight. Billing arrives in Phase 2 (M19); Phase 1 covers labour and reporting.',
    requiresMfa: true,
    permissions: [
      ...readOnly('customer', 'inbound', 'stock', 'dispatch', 'processing', 'audit'),
      ...group('report'),
      'labour:view',
      'labour:approve_earnings',
      'labour:issue_voucher',
      'customer:manage_holds',
      'document:print',
      'document:reprint',
    ],
  },
  {
    code: ROLE_CODES.LABOUR_COORDINATOR,
    nameEn: 'Labour Coordinator',
    nameAm: 'የሠራተኛ አስተባባሪ',
    description: 'Manages gangs and piece-rate payment.',
    requiresMfa: false,
    permissions: [
      ...group('labour'),
      'goods_receipt:view',
      'job_order:view',
      'dispatch:view',
      'document:print',
      'report:view_operational',
    ],
  },
  {
    code: ROLE_CODES.SECURITY_GATE_OFFICER,
    nameEn: 'Security / Gate Officer',
    nameAm: 'የደህንነት/በር ኦፊሰር',
    description: 'Verifies vehicles against gate passes and records departure.',
    requiresMfa: false,
    permissions: [
      'dispatch:view',
      'dispatch:record_gate_out',
      'goods_receipt:view',
      'document:print',
    ],
  },
  {
    code: ROLE_CODES.AUDITOR,
    nameEn: 'Auditor',
    nameAm: 'ኦዲተር',
    description:
      'Read-only across the whole system. Holds NO write permission — asserted by test.',
    requiresMfa: false,
    permissions: [...READ_ONLY_PERMISSIONS],
  },
  {
    code: ROLE_CODES.CUSTOMER,
    nameEn: 'Customer',
    nameAm: 'ደንበኛ',
    description:
      'Portal user. Sees only their own data, enforced at the data layer by RLS as well as by query scoping.',
    requiresMfa: false,
    permissions: [
      'portal:view_own_stock',
      'portal:view_own_documents',
      'delivery_request:view',
      'delivery_request:create',
      'delivery_request:cancel',
      'processing_request:view',
      'processing_request:create',
      'appointment:view',
      'acceptance:view',
      'acceptance:sign',
      'release_request:view',
      'release_request:create',
      'goods_receipt:view',
      'stock:view',
    ],
  },
] as const

/** Deduplicated permission set for a role. */
export function permissionsForRole(code: RoleCode): readonly string[] {
  const definition = ROLES.find((r) => r.code === code)
  if (!definition) throw new Error(`Unknown role: ${code}`)
  return [...new Set(definition.permissions)]
}

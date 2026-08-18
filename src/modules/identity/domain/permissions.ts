/**
 * THE PERMISSION CATALOGUE — code-owned, synced to the database on every deploy.
 *
 * A permission is `<resource>:<action>` — the client document's own definition:
 * "a specific action on a specific object, such as 'approve delivery request' or
 * 'post stock adjustment'."
 *
 * Why the catalogue lives in code but the role MAPPING lives in the database:
 *   • a new permission can never be missing in production (it ships with the code that
 *     checks it), while
 *   • who-can-do-what stays configurable by an administrator without a release (M23).
 *
 * Adding a permission here is a deliberate act: it is a new capability of the system.
 * Granting it is a configuration change.
 */

export interface PermissionDefinition {
  readonly code: string
  readonly resource: string
  readonly action: string
  readonly description: string
  readonly group: string
  /** True for read-only actions. Asserted against the Auditor role by a test. */
  readonly readOnly: boolean
}

function p(
  code: string,
  description: string,
  group: string,
  readOnly = false,
): PermissionDefinition {
  const [resource = '', action = ''] = code.split(':')
  return { code, resource, action, description, group, readOnly }
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
  // ── M08 Onboarding ────────────────────────────────────────────────────────
  p('customer_application:view', 'View customer applications', 'onboarding', true),
  p('customer_application:review', 'Take an application for review', 'onboarding'),
  p('customer_application:verify_document', 'Verify a submitted KYC document', 'onboarding'),
  p(
    'customer_application:approve',
    'Approve an application and issue credentials',
    'onboarding',
  ),
  p('customer_application:reject', 'Reject an application (comment mandatory)', 'onboarding'),
  p('customer_application:message', 'Reply to an applicant on their application', 'onboarding'),

  // ── Customer master ───────────────────────────────────────────────────────
  p('customer:view', 'View customer records', 'customer', true),
  p('customer:create', 'Create a customer record', 'customer'),
  p('customer:update', 'Update customer details', 'customer'),
  p('customer:suspend', 'Suspend a customer', 'customer'),
  p('customer:manage_documents', 'Add, replace or expire customer documents', 'customer'),
  p('customer:manage_holds', 'Place or release an administrative hold', 'customer'),

  // ── M11 Inbound ───────────────────────────────────────────────────────────
  p('delivery_request:view', 'View delivery requests', 'inbound', true),
  p('delivery_request:create', 'Submit a delivery request', 'inbound'),
  p('delivery_request:approve', 'Approve a delivery request', 'inbound'),
  p(
    'delivery_request:approve_high_value',
    'Approve a delivery request above the configured tonnage threshold',
    'inbound',
  ),
  p('delivery_request:reject', 'Reject a delivery request (comment mandatory)', 'inbound'),
  p('delivery_request:cancel', 'Cancel a delivery request', 'inbound'),

  p('goods_receipt:view', 'View goods receipts', 'inbound', true),
  p('goods_receipt:create', 'Open a goods receipt against an approved request', 'inbound'),
  p('goods_receipt:record_weight', 'Record a weighing', 'inbound'),
  p('goods_receipt:witness_weight', 'Witness a weighing (second person)', 'inbound'),
  p(
    'goods_receipt:confirm_count',
    'Confirm the kesha count — the figure labour is paid from',
    'inbound',
  ),

  p('store_placement:create', 'Place a consignment into a room and section', 'inbound'),
  p('store_placement:transfer', 'Transfer stock between locations', 'stock'),

  // ── Stock ─────────────────────────────────────────────────────────────────
  p('stock:view', 'View stock balances and the movement ledger', 'stock', true),
  p('stock:adjust', 'Post a stock adjustment (reason code mandatory)', 'stock'),
  p('stock:count', 'Perform a physical stock count', 'stock'),
  p('stock:approve_count_variance', 'Approve a physical-count variance', 'stock'),

  // ── M12 Warehouse ─────────────────────────────────────────────────────────
  p('warehouse:view', 'View warehouses, rooms, sections and occupancy', 'warehouse', true),
  p('warehouse:manage', 'Create and modify storage locations', 'warehouse'),
  p('warehouse:set_thresholds', 'Configure safe-fill thresholds and alerts', 'warehouse'),

  // ── M13 Kesha ─────────────────────────────────────────────────────────────
  p('kesha:view', 'View bag stock and reconciliations', 'kesha', true),
  p('kesha:manage_empty_stock', 'Receive and issue empty bags', 'kesha'),
  p('kesha:reconcile', 'Reconcile bag counts', 'kesha'),

  // ── M14 Scheduling ────────────────────────────────────────────────────────
  p('processing_request:view', 'View processing requests', 'scheduling', true),
  p('processing_request:create', 'Submit a processing request', 'scheduling'),
  p('processing_request:approve', 'Approve a processing request', 'scheduling'),
  p('appointment:view', 'View the production calendar', 'scheduling', true),
  p('appointment:schedule', 'Allocate an appointment', 'scheduling'),
  p('appointment:reschedule', 'Reschedule an appointment (reason mandatory)', 'scheduling'),
  p('appointment:cancel', 'Cancel an appointment', 'scheduling'),

  // ── M15 Processing ────────────────────────────────────────────────────────
  p('job_order:view', 'View job orders', 'processing', true),
  p('job_order:accept', 'Accept a job as operator', 'processing'),
  p('job_order:start', 'Start a job', 'processing'),
  p('job_order:override_schedule', 'Start a job outside its scheduled window', 'processing'),
  p('job_order:record_output', 'Record a processing output', 'processing'),
  p('job_order:close', 'Close a job whose mass balance is within tolerance', 'processing'),
  p(
    'job_order:close_with_variance',
    'Close a job outside tolerance with a recorded explanation',
    'processing',
  ),

  // ── M16 Acceptance ────────────────────────────────────────────────────────
  p('acceptance:view', 'View acceptance packs', 'acceptance', true),
  p('acceptance:issue', 'Issue an acceptance pack to a customer', 'acceptance'),
  p('acceptance:sign', 'Sign the Mirt Merekebiya as the customer', 'acceptance'),
  p(
    'acceptance:sign_on_behalf',
    'Record a wet-ink signature on the customer’s behalf',
    'acceptance',
  ),

  // ── M17 Dispatch ──────────────────────────────────────────────────────────
  p('release_request:view', 'View release requests', 'dispatch', true),
  p('release_request:create', 'Request release of accepted lots', 'dispatch'),
  p('release_request:approve', 'Approve a release request', 'dispatch'),
  p('dispatch:view', 'View dispatches', 'dispatch', true),
  p('dispatch:schedule', 'Schedule a collection', 'dispatch'),
  p('dispatch:load', 'Record truck loading', 'dispatch'),
  p('dispatch:issue_gate_pass', 'Issue a gate pass', 'dispatch'),
  p('dispatch:record_gate_out', 'Record gate-out and deduct stock', 'dispatch'),
  p('dispatch:override_hold', 'Release a dispatch despite a customer hold', 'dispatch'),

  // ── M18 Labour ────────────────────────────────────────────────────────────
  p('labour:view', 'View gangs, activities and earnings', 'labour', true),
  p('labour:manage_gangs', 'Manage gangs and workers', 'labour'),
  p('labour:manage_rates', 'Manage piece rates', 'labour'),
  p('labour:approve_earnings', 'Approve calculated earnings', 'labour'),
  p('labour:issue_voucher', 'Issue a labour payment voucher', 'labour'),

  // ── M06 Printing ──────────────────────────────────────────────────────────
  p('document:print', 'Print an operational document', 'printing'),
  p('document:reprint', 'Reprint a document as a watermarked duplicate', 'printing'),
  p('label:print', 'Print lot and bag labels', 'printing'),

  // ── M05 Document management & e-signature ────────────────────────────────
  p('document:sign', 'Capture a signature on a document', 'documents'),
  p('document:manage_versions', 'Create a new version of a logical document', 'documents'),

  // ── M03 Workflow ──────────────────────────────────────────────────────────
  p('workflow:manage_definitions', 'Create and edit workflow definitions', 'workflow'),
  p('workflow:decide_task', 'Act on a task in the approval inbox', 'workflow'),

  // ── M07 Audit ─────────────────────────────────────────────────────────────
  p('audit:view', 'View the activity log and coffee passport', 'audit', true),
  p('audit:export', 'Export audit records', 'audit', true),

  // ── M02 Master data ───────────────────────────────────────────────────────
  p('master_data:view', 'View master data', 'master_data', true),
  p('master_data:manage', 'Create and version master data', 'master_data'),

  // ── M23 Administration ────────────────────────────────────────────────────
  p('admin:manage_users', 'Create, suspend and manage users', 'admin'),
  p('admin:manage_roles', 'Assign roles and edit role permissions', 'admin'),
  p('admin:manage_settings', 'Change business rules, tolerances and thresholds', 'admin'),
  p('admin:manage_numbering', 'Configure document numbering series', 'admin'),
  p('admin:impersonate', 'Impersonate a user for support (read-only, audited)', 'admin'),
  p('support_ticket:view', 'View support tickets', 'admin', true),
  p('support_ticket:manage', 'Manage support tickets', 'admin'),

  // ── Reporting ─────────────────────────────────────────────────────────────
  p('report:view_operational', 'View operational reports', 'report', true),
  p('report:view_financial', 'View revenue and receivables reports', 'report', true),
  p('report:export', 'Export report data', 'report', true),

  // ── M10 Contracts & Tariffs ───────────────────────────────────────────────
  p('contract:view', 'View contracts and tariffs', 'commercial', true),
  p('contract:create', 'Create a draft contract', 'commercial'),
  p('contract:manage_tariff', 'Add negotiated or standard tariff lines', 'commercial'),
  p('contract:activate', 'Activate a draft contract', 'commercial'),
  p('contract:terminate', 'Terminate an active contract', 'commercial'),

  // ── Portal (customer-facing) ──────────────────────────────────────────────
  p('portal:view_own_stock', 'View own stock position', 'portal', true),
  p('portal:view_own_documents', 'View own documents', 'portal', true),

  // ── M19/M20 Billing, invoicing, receivables and storage charging ──────────
  p('billing:view', 'View invoices, payments and holds', 'commercial', true),
  p('billing:raise_charge', 'Raise a charge manually against a source record', 'commercial'),
  p('billing:generate_invoice', 'Generate, issue and void invoices', 'commercial'),
  p('billing:record_payment', 'Record a customer payment', 'commercial'),
  p('billing:manage_credit_hold', 'Release a customer credit hold', 'commercial'),
  p('billing:override_hold', 'Proceed despite a customer financial hold', 'commercial'),
  p(
    'billing:manage_storage_rates',
    'Manage storage rate tiers and run storage charging',
    'commercial',
  ),
] as const

export type PermissionCode = (typeof PERMISSIONS)[number]['code']

/** Fast membership check; also proves at import time that codes are unique. */
export const PERMISSION_CODES: ReadonlySet<string> = (() => {
  const set = new Set<string>()
  for (const perm of PERMISSIONS) {
    if (set.has(perm.code)) {
      throw new Error(`Duplicate permission code in the catalogue: ${perm.code}`)
    }
    set.add(perm.code)
  }
  return set
})()

export function isKnownPermission(code: string): code is PermissionCode {
  return PERMISSION_CODES.has(code)
}

export const READ_ONLY_PERMISSIONS: readonly string[] = PERMISSIONS.filter(
  (perm) => perm.readOnly,
).map((perm) => perm.code)

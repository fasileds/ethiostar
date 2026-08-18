/**
 * M23 — the settings catalogue.
 *
 * "declare every runtime business setting with type, default, unit, description and
 * editableByRole" (roadmap Step 2 / Step 23). Declared in code so a typo in a key is a
 * compile error; the VALUE lives in `system_setting`, seeded from `defaultValue` on first
 * deploy and never overwritten by a later deploy (see `db/seeds`).
 *
 * Every place in the codebase that currently hardcodes one of these numbers — most visibly
 * `processing/application/close-job.ts`'s `DEFAULT_TOLERANCE_PCT` — is a placeholder ahead
 * of this catalogue existing. Reading through `settings()` at call time, rather than a
 * module-level constant, is the follow-up once this module is wired into those call sites.
 */

export type SettingValueType =
  'number' | 'string' | 'boolean' | 'json' | 'duration' | 'percentage'

export interface SettingDefinition {
  readonly key: string
  readonly valueType: SettingValueType
  readonly defaultValue: unknown
  readonly description: string
  readonly unit: string | null
  readonly editableByPermission: string
}

export const SETTINGS_CATALOGUE: readonly SettingDefinition[] = [
  {
    key: 'processing.mass_balance_tolerance_pct',
    valueType: 'percentage',
    defaultValue: 2,
    description:
      'A job can close within this variance without an explanation. ⚠️ Decision #2 owed by EthioStar — see docs/phase-1/STATUS.md.',
    unit: '%',
    editableByPermission: 'admin:manage_settings',
  },
  {
    key: 'warehouse.default_safe_fill_pct',
    valueType: 'percentage',
    defaultValue: 90,
    description:
      'Default safe-fill threshold for a new store section, before any per-section override.',
    unit: '%',
    editableByPermission: 'admin:manage_settings',
  },
  {
    key: 'inbound.reservation_grace_days',
    valueType: 'number',
    defaultValue: 3,
    description:
      'How long an approved delivery request holds its capacity reservation past the expected arrival date.',
    unit: 'days',
    editableByPermission: 'admin:manage_settings',
  },
  {
    key: 'onboarding.document_expiry_warning_days',
    valueType: 'number',
    defaultValue: 30,
    description: 'How many days before a KYC document expires that the reminder fires.',
    unit: 'days',
    editableByPermission: 'admin:manage_settings',
  },
  {
    key: 'auth.session_timeout_minutes',
    valueType: 'duration',
    defaultValue: 60,
    description: 'Idle session timeout before a re-authentication is required.',
    unit: 'minutes',
    editableByPermission: 'admin:manage_settings',
  },
] as const

export function findSettingDefinition(key: string): SettingDefinition | undefined {
  return SETTINGS_CATALOGUE.find((s) => s.key === key)
}

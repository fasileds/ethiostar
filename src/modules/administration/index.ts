/**
 * M23 — System Administration, Configuration & Support Desk.
 *
 * "Lets EthioStar own and run the system — configuring rules, tolerances and templates
 * without a developer." Phase 1 scope landed here: the settings console (the module's own
 * key control — every change logged with old and new value) and staff user provisioning
 * (built in `@modules/identity`, surfaced through the admin screens).
 *
 * NOT YET BUILT, and left as an explicit gap rather than a silent one: generic master-data
 * CRUD screens (coffee types, bag types, machines, labour rates, reason codes), notification
 * template editing, and the governance views (dormant accounts, exception register). The
 * admin hub at `src/app/(staff)/admin/page.tsx` links to routes for these that do not exist
 * yet — see that file's own list for the full accounting.
 */

export {
  SETTINGS_CATALOGUE,
  findSettingDefinition,
  type SettingDefinition,
  type SettingValueType,
} from './domain/settings-catalogue'

export {
  listSettings,
  findSetting,
  ensureSettingSeeded,
  settingHistory,
  type SettingRow,
  type SettingHistoryRow,
} from './infrastructure/settings.repository'

export { updateSystemSetting } from './application/update-setting'

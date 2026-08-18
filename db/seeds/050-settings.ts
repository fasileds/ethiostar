import { SETTINGS_CATALOGUE } from '../../src/modules/administration/domain/settings-catalogue'
import { ensureSettingSeeded } from '../../src/modules/administration/infrastructure/settings.repository'
import { SYSTEM_ACTOR_ID } from '../../src/modules/identity/domain/actor'
import type { SeedContext } from './types'

/**
 * M23 settings catalogue → rows.
 *
 * `ensureSettingSeeded` only inserts; it never overwrites a value an administrator already
 * set through the console. A deploy that changed a code default must not silently revert a
 * decision EthioStar made in production.
 */
export async function seedSettings(ctx: SeedContext): Promise<void> {
  for (const definition of SETTINGS_CATALOGUE) {
    await ensureSettingSeeded(
      ctx.tx,
      definition.key,
      definition.defaultValue,
      definition.valueType,
      definition.description,
      definition.unit,
      definition.editableByPermission,
      SYSTEM_ACTOR_ID,
    )
  }
  ctx.log(`${SETTINGS_CATALOGUE.length} settings declared`)
}

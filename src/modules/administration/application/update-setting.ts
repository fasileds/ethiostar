import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { ValidationError, NotFoundError } from '@core/errors/app-error'
import { findSettingDefinition } from '../domain/settings-catalogue'
import { findSetting, updateSetting } from '../infrastructure/settings.repository'

function coerce(raw: string, valueType: string): unknown {
  if (valueType === 'number' || valueType === 'percentage' || valueType === 'duration') {
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      throw new ValidationError({ message: `"${raw}" is not a number.` })
    }
    return n
  }
  if (valueType === 'boolean') return raw === 'true'
  if (valueType === 'json') {
    try {
      return JSON.parse(raw)
    } catch {
      throw new ValidationError({ message: 'Not valid JSON.' })
    }
  }
  return raw
}

export async function updateSystemSetting(
  claims: DbClaims,
  key: string,
  rawValue: string,
  reason: string | null,
  actorId: string,
): Promise<void> {
  const definition = findSettingDefinition(key)
  if (!definition) throw NotFoundError.of('Setting', key)

  const newValue = coerce(rawValue, definition.valueType)

  await runInTransaction(claims, async (tx) => {
    const current = await findSetting(tx, key)
    if (!current) throw NotFoundError.of('Setting', key)

    await updateSetting(tx, key, current.value, newValue, reason, actorId)
  })
}

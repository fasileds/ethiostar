import 'server-only'
import type { Tx } from '@db/client'
import type { Weight } from '@core/units/weight'
import type { KeshaCount } from '@core/units/kesha'
import { lockRoomCapacity } from '@db/helpers/locks'
import { assertFits, checkFit, type CapacityCheckResult } from '../domain/capacity'
import {
  sectionFigures,
  reserveCapacity,
  type ReserveCapacityInput,
} from '../infrastructure/capacity.repository'

/**
 * The whole point of M12, as one call: lock the room, read the CURRENT figures under that
 * lock, and only then decide whether the request fits.
 *
 * Locking before reading — not reading then locking — is what closes the race two concurrent
 * approvals for the same room would otherwise hit: without the lock, both transactions can
 * read "80 kg free" before either has reserved anything, both conclude a 60 kg request fits,
 * and both insert a reservation for space that only existed once.
 */
export async function reserveIfFits(
  tx: Tx,
  locationId: string,
  request: { quantityKg: Weight; keshaCount: KeshaCount },
  reservation: Omit<ReserveCapacityInput, 'locationId'>,
  locationLabel: string,
): Promise<string> {
  await lockRoomCapacity(tx, locationId)

  const figures = await sectionFigures(tx, locationId)
  assertFits(figures, request, locationLabel)

  // reserveCapacity re-acquires the same (already-held, transaction-scoped) lock — harmless,
  // Postgres advisory locks are re-entrant within one transaction.
  return reserveCapacity(tx, { ...reservation, locationId })
}

/** Read-only check, for the pre-arrival "will it fit?" screen — no lock, no side effect. */
export async function checkAvailability(
  tx: Tx,
  locationId: string,
  request: { quantityKg: Weight; keshaCount: KeshaCount },
): Promise<CapacityCheckResult> {
  const figures = await sectionFigures(tx, locationId)
  return checkFit(figures, request)
}

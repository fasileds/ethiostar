import { withServiceDb, type Tx } from '@db/client'
import { SYSTEM_ACTOR_ID } from '@modules/identity'
import { expireReservations } from '@modules/warehouse'
import type { JobContext } from './types'

/**
 * Expire capacity reservations past their grace period (Step 13).
 *
 * A reservation nobody consumed — a delivery request approved but the truck never came —
 * would otherwise hold space forever, and the room reads as full when it is not. The sweep
 * is the release valve: `expireReservations` flips ACTIVE rows past `expires_at` to EXPIRED
 * in one statement, which is what `vw_section_capacity` already excludes from `reserved_kg`.
 */
export async function reservationExpiryScan(ctx: JobContext): Promise<void> {
  const expired = await withServiceDb(
    SYSTEM_ACTOR_ID,
    'capacity:expire-reservations',
    (tx: Tx) => expireReservations(tx),
  )

  if (expired > 0) {
    ctx.log.info({ expired }, 'expired capacity reservations past their grace period')
  }
}

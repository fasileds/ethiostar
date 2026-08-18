import { defineEvent } from '@core/domain/domain-event'
import type { ConsignmentStatus, LotStatus } from './consignment.state-machine'

/**
 * Consignment-spine events.
 *
 * These are the substrate the coffee-passport timeline (M07) is built from and the events
 * M04's notification subscribers key on — see `notification/infrastructure/subscriptions.ts`
 * as each owning module (M11, M14, M15, M16, M17) is built, since a tier-2 module cannot
 * import a tier-4/5 one and reacts to the event NAME instead.
 */

export interface ConsignmentStatusChangedPayload {
  readonly reference: string
  readonly fromStatus: ConsignmentStatus | null
  readonly toStatus: ConsignmentStatus
  readonly reason: string | null
  // Event payloads are persisted as jsonb and passed around as
  // `Readonly<Record<string, unknown>>`; the index signature is what makes this specific
  // shape structurally assignable to that at the `publishEvents` call site.
  readonly [key: string]: unknown
}

export const consignmentStatusChanged = defineEvent<
  'ConsignmentStatusChanged',
  ConsignmentStatusChangedPayload
>('ConsignmentStatusChanged', 1, 'Consignment')

export interface LotStatusChangedPayload {
  readonly reference: string
  readonly consignmentId: string
  readonly fromStatus: LotStatus | null
  readonly toStatus: LotStatus
  readonly reason: string | null
  readonly [key: string]: unknown
}

export const lotStatusChanged = defineEvent<'LotStatusChanged', LotStatusChangedPayload>(
  'LotStatusChanged',
  1,
  'Lot',
)

export interface LotCreatedPayload {
  readonly reference: string
  readonly consignmentId: string
  readonly customerId: string
  readonly initialQuantityKg: string
  readonly initialKeshaCount: number
  /** Non-null only for a produced lot — an output of a processing job. */
  readonly outputClassificationId: string | null
  readonly [key: string]: unknown
}

export const lotCreated = defineEvent<'LotCreated', LotCreatedPayload>('LotCreated', 1, 'Lot')

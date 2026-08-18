import 'server-only'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { systemClock } from '@core/clock/clock'
import { transitionConsignment } from '@modules/consignment'
import { reserveIfFits } from '@modules/warehouse'
import { queueNotification, NOTIFICATION_TEMPLATES } from '@modules/notification'
import { findCustomer } from '@modules/customers'
import {
  lockDeliveryRequest,
  transitionDeliveryRequest,
  approveDeliveryRequestRow,
  rejectDeliveryRequestRow,
} from '../infrastructure/delivery-request.repository'

/** Reservations hold space for this long past the declared arrival date before expiring. */
const RESERVATION_GRACE_DAYS = 3

export interface ApproveDeliveryRequestInput {
  readonly deliveryRequestId: string
  readonly locationId: string
  readonly actorId: string
}

async function notifyApproved(
  tx: Tx,
  header: Awaited<ReturnType<typeof lockDeliveryRequest>>,
  input: ApproveDeliveryRequestInput,
  now: Date,
): Promise<void> {
  const customer = await findCustomer(tx, header.customerId)
  if (!customer?.primaryEmail) return

  await queueNotification(tx, {
    templateCode: NOTIFICATION_TEMPLATES.DELIVERY_REQUEST_APPROVED,
    recipientAddress: customer.primaryEmail,
    recipientCustomerId: header.customerId,
    variables: {
      contactName: customer.legalName,
      reference: header.reference,
      quantityKg: header.declaredQuantityKg,
      keshaCount: header.declaredKeshaCount,
      expectedDate: now.toISOString().slice(0, 10),
      branchName: header.branchName ?? header.branchId,
    },
    sourceType: 'delivery_request',
    sourceId: input.deliveryRequestId,
    actorId: input.actorId,
  })
}

/**
 * Approve a request: THE M11 key control. `reserveIfFits` fails the whole operation before
 * anything else changes if the room does not have space — "coffee is never accepted against
 * space that does not exist."
 */
export async function approveDeliveryRequest(
  claims: DbClaims,
  input: ApproveDeliveryRequestInput,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const header = await lockDeliveryRequest(tx, input.deliveryRequestId)
    if (!header.consignmentId) {
      throw new Error(`Delivery request ${input.deliveryRequestId} has no consignment`)
    }

    const now = systemClock.now()
    const expiresAt = new Date(now.getTime() + RESERVATION_GRACE_DAYS * 24 * 60 * 60 * 1000)
    const requested = {
      quantityKg: Weight.fromKg(header.declaredQuantityKg),
      keshaCount: KeshaCount.from(header.declaredKeshaCount),
    }

    const reservationId = await reserveIfFits(
      tx,
      input.locationId,
      requested,
      {
        deliveryRequestId: input.deliveryRequestId,
        customerId: header.customerId,
        ...requested,
        expiresAt,
        actorId: input.actorId,
      },
      'The selected location',
    )

    await transitionDeliveryRequest(
      tx,
      input.deliveryRequestId,
      header.status,
      'APPROVED',
      input.actorId,
    )
    await approveDeliveryRequestRow(
      tx,
      input.deliveryRequestId,
      input.actorId,
      reservationId,
      header.consignmentId,
    )

    await transitionConsignment(tx, {
      id: header.consignmentId,
      to: 'ACCEPTED',
      actorId: input.actorId,
      occurredAt: now,
      correlationId: input.deliveryRequestId,
    })

    await notifyApproved(tx, header, input, now)
  })
}

export interface RejectDeliveryRequestInput {
  readonly deliveryRequestId: string
  readonly reason: string
  readonly actorId: string
}

export async function rejectDeliveryRequest(
  claims: DbClaims,
  input: RejectDeliveryRequestInput,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const header = await lockDeliveryRequest(tx, input.deliveryRequestId)

    await transitionDeliveryRequest(
      tx,
      input.deliveryRequestId,
      header.status,
      'REJECTED',
      input.actorId,
      input.reason,
    )
    await rejectDeliveryRequestRow(tx, input.deliveryRequestId, input.reason)

    if (header.consignmentId) {
      await transitionConsignment(tx, {
        id: header.consignmentId,
        to: 'CANCELLED',
        actorId: input.actorId,
        occurredAt: systemClock.now(),
        reason: input.reason,
        correlationId: input.deliveryRequestId,
      })
    }

    const customer = await findCustomer(tx, header.customerId)
    if (customer?.primaryEmail) {
      await queueNotification(tx, {
        templateCode: NOTIFICATION_TEMPLATES.DELIVERY_REQUEST_REJECTED,
        recipientAddress: customer.primaryEmail,
        recipientCustomerId: header.customerId,
        variables: {
          contactName: customer.legalName,
          reference: header.reference,
          reason: input.reason,
        },
        sourceType: 'delivery_request',
        sourceId: input.deliveryRequestId,
        actorId: input.actorId,
      })
    }
  })
}

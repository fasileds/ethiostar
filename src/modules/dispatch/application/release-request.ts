import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { systemClock } from '@core/clock/clock'
import { transitionConsignment } from '@modules/consignment'
import { queueNotification, NOTIFICATION_TEMPLATES } from '@modules/notification'
import { findCustomer } from '@modules/customers'
import {
  insertReleaseRequest,
  lockReleaseRequest,
  transitionReleaseRequest,
  type CreateReleaseRequestInput,
} from '../infrastructure/release-request.repository'
import { createDispatchOrder } from '../infrastructure/dispatch-order.repository'

/** Submit a release request — the customer's Stage 4 opening move. */
export async function submitReleaseRequest(
  claims: DbClaims,
  input: CreateReleaseRequestInput,
): Promise<{ id: string; reference: string }> {
  return runInTransaction(claims, async (tx) => {
    const request = await insertReleaseRequest(tx, input)
    await transitionConsignment(tx, {
      id: input.consignmentId,
      to: 'RELEASE_REQUESTED',
      actorId: input.actorId,
      occurredAt: systemClock.now(),
      correlationId: request.id,
    })
    return request
  })
}

export async function rejectReleaseRequest(
  claims: DbClaims,
  releaseRequestId: string,
  reason: string,
  actorId: string,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const header = await lockReleaseRequest(tx, releaseRequestId)
    await transitionReleaseRequest(tx, releaseRequestId, header.status, 'REJECTED', {
      rejectionReason: reason,
    })
    await transitionConsignment(tx, {
      id: header.consignmentId,
      to: 'ACCEPTED_BY_CUSTOMER',
      actorId,
      occurredAt: systemClock.now(),
      reason,
      correlationId: releaseRequestId,
    })
  })
}

/** Approve a release request and open the dispatch order it will be loaded against. */
export async function approveReleaseRequest(
  claims: DbClaims,
  releaseRequestId: string,
  actorId: string,
): Promise<{ dispatchOrderId: string; reference: string }> {
  return runInTransaction(claims, async (tx) => {
    const header = await lockReleaseRequest(tx, releaseRequestId)
    await transitionReleaseRequest(tx, releaseRequestId, header.status, 'APPROVED')

    const order = await createDispatchOrder(tx, {
      branchId: header.branchId,
      customerId: header.customerId,
      consignmentId: header.consignmentId,
      releaseRequestId,
      plannedQuantityKg: header.requestedQuantityKg,
      plannedKeshaCount: header.requestedKeshaCount,
      vehiclePlate: header.vehiclePlate,
      driverName: null,
      transporterName: null,
      destination: null,
      actorId,
    })

    const customer = await findCustomer(tx, header.customerId)
    if (customer?.primaryEmail) {
      await queueNotification(tx, {
        templateCode: NOTIFICATION_TEMPLATES.DISPATCH_SCHEDULED,
        recipientAddress: customer.primaryEmail,
        recipientCustomerId: header.customerId,
        variables: {
          contactName: customer.legalName,
          dispatchReference: order.reference,
          scheduledDate: systemClock.now().toISOString().slice(0, 10),
          quantityKg: header.requestedQuantityKg,
          keshaCount: header.requestedKeshaCount ?? 0,
          vehiclePlate: header.vehiclePlate ?? '',
        },
        sourceType: 'dispatch_order',
        sourceId: order.id,
        actorId,
      })
    }

    return { dispatchOrderId: order.id, reference: order.reference }
  })
}

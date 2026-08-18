import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { queueNotification, NOTIFICATION_TEMPLATES } from '@modules/notification'
import { findCustomer } from '@modules/customers'
import {
  insertProcessingRequest,
  lockProcessingRequest,
  transitionProcessingRequest,
  type CreateProcessingRequestInput,
} from '../infrastructure/processing-request.repository'

/** Submit a processing request — the customer's Stage 3 opening move. */
export async function submitProcessingRequest(
  claims: DbClaims,
  input: CreateProcessingRequestInput,
): Promise<{ id: string; reference: string }> {
  return runInTransaction(claims, (tx) => insertProcessingRequest(tx, input))
}

export interface RejectProcessingRequestInput {
  readonly processingRequestId: string
  readonly reason: string
  readonly actorId: string
}

export async function rejectProcessingRequest(
  claims: DbClaims,
  input: RejectProcessingRequestInput,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const header = await lockProcessingRequest(tx, input.processingRequestId)
    await transitionProcessingRequest(
      tx,
      input.processingRequestId,
      header.status,
      'REJECTED',
      input.actorId,
      { rejectionReason: input.reason },
    )

    const customer = await findCustomer(tx, header.customerId)
    if (customer?.primaryEmail) {
      await queueNotification(tx, {
        templateCode: NOTIFICATION_TEMPLATES.PROCESSING_REQUEST_REJECTED,
        recipientAddress: customer.primaryEmail,
        recipientCustomerId: header.customerId,
        variables: {
          contactName: customer.legalName,
          reference: header.reference,
          reason: input.reason,
        },
        sourceType: 'processing_request',
        sourceId: input.processingRequestId,
        actorId: input.actorId,
      })
    }
  })
}

export async function approveProcessingRequest(
  claims: DbClaims,
  processingRequestId: string,
  actorId: string,
): Promise<void> {
  await runInTransaction(claims, async (tx) => {
    const header = await lockProcessingRequest(tx, processingRequestId)
    await transitionProcessingRequest(
      tx,
      processingRequestId,
      header.status,
      'APPROVED',
      actorId,
    )

    const customer = await findCustomer(tx, header.customerId)
    if (customer?.primaryEmail) {
      await queueNotification(tx, {
        templateCode: NOTIFICATION_TEMPLATES.PROCESSING_REQUEST_APPROVED,
        recipientAddress: customer.primaryEmail,
        recipientCustomerId: header.customerId,
        variables: {
          contactName: customer.legalName,
          reference: header.reference,
          quantityKg: header.requestedQuantityKg,
        },
        sourceType: 'processing_request',
        sourceId: processingRequestId,
        actorId,
      })
    }
  })
}

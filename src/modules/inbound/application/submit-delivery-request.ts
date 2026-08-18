import 'server-only'
import { sql } from 'drizzle-orm'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { createConsignment } from '@modules/consignment'
import {
  insertDeliveryRequest,
  type CreateDeliveryRequestInput,
} from '../infrastructure/delivery-request.repository'

/**
 * Submit a delivery request (M09/M11) — Stage 2's opening move.
 *
 * Creates the delivery request AND the consignment it will become, in one transaction: a
 * consignment's REQUESTED state is defined (`consignment.state-machine.ts`) as "customer
 * submitted a delivery request", so the spine begins here rather than waiting for approval.
 */
export async function submitDeliveryRequest(
  claims: DbClaims,
  input: CreateDeliveryRequestInput,
): Promise<{ deliveryRequestId: string; reference: string; consignmentId: string }> {
  return runInTransaction(claims, async (tx) => {
    const request = await insertDeliveryRequest(tx, input)

    const { id: consignmentId } = await createConsignment(tx, {
      branchId: input.branchId,
      customerId: input.customerId,
      deliveryRequestId: request.id,
      coffeeTypeId: input.coffeeTypeId ?? null,
      originWoredaId: input.originWoredaId ?? null,
      harvestYearId: input.harvestYearId ?? null,
      declaredQuantityKg: input.declaredQuantityKg,
      declaredKeshaCount: input.declaredKeshaCount,
      expectedArrivalOn: input.expectedArrivalOn,
      actorId: input.actorId,
    })

    // Link back so the request can find its consignment without a second write path.
    await tx.execute(sql`
      update public.delivery_request set consignment_id = ${consignmentId}::uuid where id = ${request.id}::uuid
    `)

    return { deliveryRequestId: request.id, reference: request.reference, consignmentId }
  })
}

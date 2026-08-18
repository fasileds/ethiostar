import 'server-only'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { Weight } from '@core/units/weight'
import { KeshaCount } from '@core/units/kesha'
import { systemClock } from '@core/clock/clock'
import { transitionConsignment, transitionLot } from '@modules/consignment'
import { lockJobOrder } from '@modules/processing'
import { queueNotification, NOTIFICATION_TEMPLATES } from '@modules/notification'
import { findCustomer } from '@modules/customers'
import {
  createAcceptancePack,
  lockAcceptance,
  acceptanceLotIds,
  signAcceptanceRow,
  type SignAcceptanceInput,
} from '../infrastructure/acceptance.repository'
import { jobOutputsForAcceptance } from '../infrastructure/job-output-lines.query'

/**
 * Issue the acceptance pack from a closed job — the moment EthioStar presents what it
 * produced and asks the customer to sign. The consignment stays PROCESSED until signature;
 * ownership passes at `signAcceptance`, not here.
 */
export async function issueAcceptancePack(
  claims: DbClaims,
  jobOrderId: string,
  actorId: string,
): Promise<{ acceptanceId: string; reference: string }> {
  return runInTransaction(claims, async (tx) => {
    const job = await lockJobOrder(tx, jobOrderId)
    if (job.status !== 'CLOSED') {
      throw new Error(
        `Job order ${jobOrderId} must be CLOSED before its outputs can be presented`,
      )
    }

    const lines = await jobOutputsForAcceptance(tx, jobOrderId)
    const presentedKg = Weight.sum(lines.map((l) => Weight.fromKg(l.quantityKg)))
    const presentedKesha = KeshaCount.sum(lines.map((l) => KeshaCount.from(l.keshaCount ?? 0)))

    const pack = await createAcceptancePack(tx, {
      branchId: job.branchId,
      customerId: job.customerId,
      consignmentId: job.consignmentId,
      jobOrderId,
      presentedQuantityKg: presentedKg.toKgString(),
      presentedKeshaCount: presentedKesha.toNumber(),
      yieldPct: null,
      lossPct: null,
      presentedBy: actorId,
      lines,
    })

    const customer = await findCustomer(tx, job.customerId)
    if (customer?.primaryEmail) {
      await queueNotification(tx, {
        templateCode: NOTIFICATION_TEMPLATES.OUTPUT_READY_FOR_ACCEPTANCE,
        recipientAddress: customer.primaryEmail,
        recipientCustomerId: job.customerId,
        variables: {
          contactName: customer.legalName,
          jobReference: job.reference,
          acceptanceUrl: `/portal/acceptances/${pack.id}`,
        },
        sourceType: 'acceptance_record',
        sourceId: pack.id,
        actorId,
      })
    }

    return { acceptanceId: pack.id, reference: pack.reference }
  })
}

/**
 * Sign the acceptance: the customer takes ownership of the processed outputs. Both signature
 * routes (portal click, wet-ink scan) go through this same function and produce the same
 * auditable outcome — the difference is only in `input.method` and where the bytes came from.
 */
export async function signAcceptance(
  claims: DbClaims,
  acceptanceId: string,
  input: SignAcceptanceInput,
  actorId: string,
): Promise<void> {
  await runInTransaction(claims, async (tx: Tx) => {
    const header = await lockAcceptance(tx, acceptanceId)
    if (header.status !== 'PRESENTED') {
      throw new Error(`Acceptance ${acceptanceId} is not awaiting signature`)
    }

    await signAcceptanceRow(
      tx,
      acceptanceId,
      input,
      header.presentedQuantityKg,
      header.presentedKeshaCount,
      actorId,
    )

    const now = systemClock.now()
    const lotIds = await acceptanceLotIds(tx, acceptanceId)
    for (const lotId of lotIds) {
      await transitionLot(tx, {
        id: lotId,
        to: 'ACCEPTED',
        actorId,
        occurredAt: now,
        correlationId: acceptanceId,
      })
    }

    await transitionConsignment(tx, {
      id: header.consignmentId,
      to: 'ACCEPTED_BY_CUSTOMER',
      actorId,
      occurredAt: now,
      correlationId: acceptanceId,
    })
  })
}

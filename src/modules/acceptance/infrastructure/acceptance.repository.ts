import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { allocateDocumentNumber } from '@modules/printing'
import { DOCUMENT_SERIES } from '@config/constants'
import { acceptanceStateMachine, type AcceptanceStatus } from '../domain/acceptance-status'

export interface AcceptanceOutputLine {
  readonly lotId: string
  readonly classificationId: string | null
  readonly quantityKg: string
  readonly keshaCount: number | null
}

export interface CreateAcceptanceInput {
  readonly branchId: string
  readonly customerId: string
  readonly consignmentId: string
  readonly jobOrderId: string | null
  readonly presentedQuantityKg: string
  readonly presentedKeshaCount: number | null
  readonly yieldPct: string | null
  readonly lossPct: string | null
  readonly presentedBy: string
  readonly lines: readonly AcceptanceOutputLine[]
}

export async function createAcceptancePack(
  tx: Tx,
  input: CreateAcceptanceInput,
): Promise<{ id: string; reference: string }> {
  const id = uuidv7()
  const allocated = await allocateDocumentNumber(tx, DOCUMENT_SERIES.MIRT_MEREKEBIYA, {
    branchId: input.branchId,
    actorId: input.presentedBy,
  })

  await tx.execute(sql`
    insert into public.acceptance_record (
      id, reference, branch_id, customer_id, consignment_id, job_order_id, status,
      presented_quantity_kg, presented_kesha_count, yield_pct, loss_pct,
      presented_at, presented_by, created_by, created_at, updated_at
    ) values (
      ${id}, ${allocated.formatted}, ${input.branchId}::uuid, ${input.customerId}::uuid,
      ${input.consignmentId}::uuid, ${input.jobOrderId}::uuid, 'PRESENTED',
      ${input.presentedQuantityKg}::numeric, ${input.presentedKeshaCount},
      ${input.yieldPct}::numeric, ${input.lossPct}::numeric,
      now(), ${input.presentedBy}::uuid, ${input.presentedBy}::uuid, now(), now()
    )
  `)

  await tx.execute(sql`
    insert into public.acceptance_status_history (
      id, acceptance_id, from_status, to_status, note, occurred_at, changed_by
    ) values (${uuidv7()}, ${id}::uuid, 'DRAFT', 'PRESENTED', null, now(), ${input.presentedBy}::uuid)
  `)

  for (const [index, line] of input.lines.entries()) {
    await tx.execute(sql`
      insert into public.acceptance_line (
        id, acceptance_id, line_no, lot_id, classification_id,
        presented_quantity_kg, presented_kesha_count, line_verdict,
        created_by, created_at, updated_at
      ) values (
        ${uuidv7()}, ${id}::uuid, ${index + 1}, ${line.lotId}::uuid, ${line.classificationId}::uuid,
        ${line.quantityKg}::numeric, ${line.keshaCount}, 'ACCEPTED',
        ${input.presentedBy}::uuid, now(), now()
      )
    `)
  }

  return { id, reference: allocated.formatted }
}

interface AcceptanceHeader {
  readonly status: AcceptanceStatus
  readonly reference: string
  readonly consignmentId: string
  readonly customerId: string
  readonly presentedQuantityKg: string
  readonly presentedKeshaCount: number | null
}

export async function lockAcceptance(tx: Tx, id: string): Promise<AcceptanceHeader> {
  const rows = await rawRows(
    tx,
    sql`
      select status, reference, consignment_id, customer_id,
             presented_quantity_kg, presented_kesha_count
      from public.acceptance_record where id = ${id}::uuid for update
    `,
  )
  const row = rows[0]
  if (!row) throw new Error(`Acceptance ${id} not found`)
  return {
    status: col.text(row.status) as AcceptanceStatus,
    reference: col.text(row.reference),
    consignmentId: col.text(row.consignment_id),
    customerId: col.text(row.customer_id),
    presentedQuantityKg: col.numeric(row.presented_quantity_kg),
    presentedKeshaCount: col.intOrNull(row.presented_kesha_count),
  }
}

export async function acceptanceLotIds(tx: Tx, acceptanceId: string): Promise<string[]> {
  const rows = await rawRows(
    tx,
    sql`select lot_id from public.acceptance_line where acceptance_id = ${acceptanceId}::uuid and lot_id is not null`,
  )
  return rows.map((row) => col.text(row.lot_id))
}

export interface SignAcceptanceInput {
  readonly method: 'PORTAL_CLICK' | 'WET_INK_SCAN'
  readonly customerRepName: string
  readonly customerRepIdNo: string | null
  readonly customerContactId: string | null
  readonly signatureFileId: string | null
  readonly witnessUserId: string | null
  readonly ipAddress: string | null
}

export async function signAcceptanceRow(
  tx: Tx,
  id: string,
  input: SignAcceptanceInput,
  acceptedQuantityKg: string,
  acceptedKeshaCount: number | null,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.acceptance_record
    set status = 'ACCEPTED', accepted_quantity_kg = ${acceptedQuantityKg}::numeric,
        accepted_kesha_count = ${acceptedKeshaCount},
        customer_rep_name = ${input.customerRepName}, customer_rep_id_no = ${input.customerRepIdNo},
        customer_contact_id = ${input.customerContactId}::uuid,
        signed_at = now(), signature_file_id = ${input.signatureFileId}::uuid,
        witness_user_id = ${input.witnessUserId}::uuid,
        updated_at = now(), version = version + 1
    where id = ${id}::uuid
  `)

  await tx.execute(sql`
    insert into public.acceptance_status_history (
      id, acceptance_id, from_status, to_status, note, occurred_at, changed_by
    ) values (${uuidv7()}, ${id}::uuid, 'PRESENTED', 'ACCEPTED', ${input.method}, now(), ${actorId}::uuid)
  `)
}

export async function assertTransition(
  from: AcceptanceStatus,
  to: AcceptanceStatus,
): Promise<void> {
  acceptanceStateMachine.assert(from, to)
}

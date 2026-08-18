import 'server-only'
import { sql } from 'drizzle-orm'
import { withServiceDb } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { SYSTEM_ACTOR_ID } from '@modules/identity'

/**
 * The public `/scan/[token]` verification path — a SANCTIONED service-role use.
 *
 * "The gate officer at the gate verifies the vehicle against the pass, scans the QR code" —
 * the person scanning a coffee-sack tag is very often not a signed-in system user, and the
 * whole point of the verification page is that it must work anyway. No RLS policy can express
 * "anonymous, but only for the one row this exact token names", so this narrow file is the
 * privileged path, confined here by scripts/guard-service-role.ts.
 *
 * Two rules keep the confinement safe:
 *  1. Every function here is keyed by the TOKEN, never by an id — a caller cannot browse.
 *  2. Reads return a narrow, print-safe projection — never the internal snapshot payload.
 */

export type VerificationResult = 'VALID' | 'NOT_FOUND' | 'SUPERSEDED'

export interface VerifiedDocument {
  readonly documentType: string
  readonly documentReference: string | null
  readonly copyNo: number
  readonly isReprint: boolean
  readonly printedAt: Date
  readonly result: VerificationResult
}

export interface ScanContext {
  readonly ipAddress: string | null
  readonly userAgent: string | null
}

/**
 * Look up a presented token, log the scan either way, and report whether it verifies.
 *
 * SUPERSEDED covers a document whose source was later reprinted with a HIGHER copy number
 * still in circulation — for now every copy of a source stays independently valid (each has
 * its own token), so the only outcomes reachable today are VALID and NOT_FOUND. The result
 * type keeps SUPERSEDED available for the day a "void and reissue" flow needs it, without
 * another migration.
 */
export async function verifyPresentedToken(
  token: string,
  context: ScanContext,
): Promise<VerifiedDocument> {
  return withServiceDb(SYSTEM_ACTOR_ID, 'public document verification scan', async (tx) => {
    const rows = await rawRows(
      tx,
      sql`
        select id, document_type, document_reference, copy_no, is_reprint, printed_at
        from public.printed_document
        where verification_token = ${token}
        limit 1
      `,
    )

    const row = rows[0]
    const result: VerificationResult = row ? 'VALID' : 'NOT_FOUND'

    await tx.execute(sql`
      insert into public.document_verification (
        id, printed_document_id, presented_token, result, ip_address, user_agent, scanned_at
      ) values (
        gen_random_uuid(), ${row ? col.text(row.id) : null}::uuid, ${token}, ${result},
        ${context.ipAddress}, ${context.userAgent}, now()
      )
    `)

    if (!row) {
      return {
        documentType: '',
        documentReference: null,
        copyNo: 0,
        isReprint: false,
        printedAt: new Date(0),
        result,
      }
    }

    return {
      documentType: col.text(row.document_type),
      documentReference: col.textOrNull(row.document_reference),
      copyNo: col.int(row.copy_no),
      isReprint: col.text(row.is_reprint) === 'Y',
      printedAt: col.date(row.printed_at),
      result,
    }
  })
}

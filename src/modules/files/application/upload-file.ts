import 'server-only'
import { createHash } from 'node:crypto'
import type { DbClaims, Tx } from '@db/client'
import { runInTransaction } from '@db/transaction'
import { env } from '@config/env'
import { ValidationError } from '@core/errors/app-error'
import { uuidv7 } from '@core/ids/id-generator'
import { systemClock } from '@core/clock/clock'
import { logger } from '@core/logging/logger'
import { fileStorage, buildObjectKey } from '@platform/storage'
import { virusScanner } from '@platform/antivirus'
import { verifyUpload } from '../domain/content-type'
import {
  insertPendingFile,
  markFileAvailable,
  markFileQuarantined,
} from '../infrastructure/file.repository'

/**
 * Upload one file.
 *
 * FOUR PHASES, in this order, and the order is the design:
 *
 *   1. VERIFY   magic bytes, size, extension agreement. Pure, no I/O — the cheapest
 *               rejection happens before anything is written anywhere.
 *   2. RESERVE  the metadata row goes in PENDING and the transaction commits. An upload
 *               that dies after this leaves a row a sweeper can find, rather than an
 *               object in a bucket that nothing references.
 *   3. SCAN     then store. Scanning BEFORE the bytes reach the bucket means an infected
 *               file never lands in storage at all, so no cleanup path has to be trusted.
 *   4. PUBLISH  mark AVAILABLE. Until this commits, nothing can download or link the file.
 *
 * The transactions are separate because scanning and uploading are network I/O, and
 * docs/architecture/06-cross-cutting.md §6.3 rule 3 forbids I/O inside a transaction.
 */

export interface UploadFileInput {
  readonly filename: string
  readonly content: Buffer
  /** What this belongs to — `customer_application`, `consignment`, `acceptance`. */
  readonly sourceType: string
  readonly sourceId: string | null
  /** KYC_DOCUMENT | REQUEST_LETTER | PHOTO | SIGNATURE | REPORT | OTHER */
  readonly category: string
  readonly actorId: string
}

export interface UploadedFile {
  readonly fileId: string
  readonly contentType: string
  readonly byteSize: number
  readonly objectKey: string
}

/** Opens one transaction and runs `fn` in it — `runInTransaction(claims, ·)` or `withServiceDb(...)`. */
type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>

/**
 * Scan, and quarantine the row if the file is infected.
 *
 * Runs BEFORE the bytes reach the bucket, so an infected file never lands in storage and no
 * cleanup path has to be trusted to remove it.
 */
async function scanOrQuarantine(
  runTx: TxRunner,
  fileId: string,
  input: UploadFileInput,
): Promise<void> {
  const verdict = await virusScanner().scan(input.content)
  if (verdict.status === 'CLEAN') return

  await runTx((tx) =>
    markFileQuarantined(tx, fileId, `Virus scan: ${verdict.signature}`, input.actorId),
  )

  logger.warn(
    { fileId, signature: verdict.signature, sourceType: input.sourceType },
    'upload rejected by virus scan',
  )

  // The signature is deliberately NOT shown to the uploader. It tells an attacker which
  // engine and definitions are in use, and tells a legitimate uploader nothing they can act
  // on beyond "this file is not safe".
  throw new ValidationError({
    message: 'This file failed a security scan and was not accepted.',
    fieldErrors: [
      { path: 'file', code: 'infected', message: 'The file failed a security scan.' },
    ],
  })
}

async function uploadFileVia(runTx: TxRunner, input: UploadFileInput): Promise<UploadedFile> {
  const verified = verifyUpload(input.filename, input.content, env.UPLOAD_MAX_BYTES)

  const fileId = uuidv7()
  const storage = fileStorage()
  const objectKey = buildObjectKey(input.sourceType, fileId, input.filename, systemClock.now())
  const checksum = createHash('sha256').update(input.content).digest('hex')

  await runTx((tx) =>
    insertPendingFile(tx, {
      id: fileId,
      bucket: storage.bucket,
      objectKey,
      originalFilename: input.filename,
      contentType: verified.contentType,
      byteSize: verified.byteSize,
      checksumSha256: checksum,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      category: input.category,
      actorId: input.actorId,
    }),
  )

  await scanOrQuarantine(runTx, fileId, input)

  await storage.put({
    objectKey,
    body: input.content,
    contentType: verified.contentType,
  })

  await runTx((tx) => markFileAvailable(tx, fileId, input.actorId))

  return {
    fileId,
    contentType: verified.contentType,
    byteSize: verified.byteSize,
    objectKey,
  }
}

export async function uploadFile(
  claims: DbClaims,
  input: UploadFileInput,
): Promise<UploadedFile> {
  return uploadFileVia((fn) => runInTransaction(claims, fn), input)
}

/**
 * Same four-phase upload, for the confined service-role write paths (an
 * `infrastructure/system/` use case with no acting user — see docs/adr/0013). This module
 * never imports `withServiceDb` itself; the caller supplies it as `runTx`, so
 * scripts/guard-service-role.ts's confinement is enforced at the caller's file, not diluted
 * by adding this module to the allow-list.
 */
export async function uploadFileWithRunner(
  runTx: TxRunner,
  input: UploadFileInput,
): Promise<UploadedFile> {
  return uploadFileVia(runTx, input)
}

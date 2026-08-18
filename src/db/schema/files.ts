import {
  pgTable,
  text,
  uuid,
  integer,
  index,
  uniqueIndex,
  check,
  bigint,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { auditColumns, appendOnlyColumns, instant, sourceReference } from '../helpers/columns'

/**
 * M05 — File & Document Management.
 *
 * The BYTES live in Supabase Storage; this table is the metadata and the access-control
 * record. Two rules follow from that split and both matter:
 *
 *  1. A row is written BEFORE the upload and marked `PENDING`. An upload that dies halfway
 *     leaves a PENDING row a worker can sweep, rather than an orphan object nobody knows about.
 *  2. Nothing serves a file by public URL. Access goes through a signed URL minted per
 *     request after the same authorisation check the owning record uses — an object key is
 *     not a permission.
 *
 * docs/architecture/07-extension-points.md
 */

export const storedFile = pgTable(
  'stored_file',
  {
    id: uuid('id').primaryKey(),
    /** Supabase Storage bucket. Buckets are private; see the RLS migration. */
    bucket: text('bucket').notNull(),
    /** Object key within the bucket. Never guessable — prefixed with the file UUID. */
    objectKey: text('object_key').notNull(),

    originalFilename: text('original_filename').notNull(),
    contentType: text('content_type').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }),
    /** SHA-256 of the content, for duplicate detection and tamper evidence. */
    checksumSha256: text('checksum_sha256'),

    /** What this file belongs to — application, consignment, acceptance, dispatch. */
    ...sourceReference(),
    /** KYC_DOCUMENT | REQUEST_LETTER | PHOTO | SIGNATURE | REPORT | OTHER */
    category: text('category').notNull().default('OTHER'),

    /** PENDING → AVAILABLE → QUARANTINED | DELETED */
    status: text('status').notNull().default('PENDING'),
    uploadedAt: instant('uploaded_at'),
    /** Set when a scan rejects the file, so the reason survives the deletion. */
    quarantineReason: text('quarantine_reason'),
    deletedAt: instant('deleted_at'),

    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_stored_file__object').on(t.bucket, t.objectKey),
    index('idx_stored_file__source').on(t.sourceType, t.sourceId),
    // Sweep target for the orphan-upload worker.
    index('idx_stored_file__pending')
      .on(t.createdAt)
      .where(sql`${t.status} = 'PENDING'`),
    check(
      'ck_stored_file__status',
      sql`${t.status} in ('PENDING','AVAILABLE','QUARANTINED','DELETED')`,
    ),
    check('ck_stored_file__size', sql`${t.byteSize} is null or ${t.byteSize} >= 0`),
  ],
)

/**
 * Who looked at what.
 *
 * A customer's licence and bank details sit behind these rows; without an access log,
 * "did anyone outside the branch open this?" has no answer.
 */
export const fileAccessLog = pgTable(
  'file_access_log',
  {
    id: uuid('id').primaryKey(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => storedFile.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id'),
    /** VIEW | DOWNLOAD | SIGNED_URL_ISSUED */
    action: text('action').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    occurredAt: instant('occurred_at')
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('idx_file_access_log__file').on(t.fileId, t.occurredAt),
    index('idx_file_access_log__actor').on(t.actorId, t.occurredAt),
  ],
)

/**
 * M05 — Document Management & e-Signature.
 *
 * "Documents such as the Mirt Merekebiya can be signed in the portal, with the signer's
 * identity, timestamp and IP recorded." Phase 1 shipped the portal-click acceptance path
 * directly on `acceptance_record` (docs/phase-1/scope.md B5) because M05 was Phase 2; this
 * table generalises that pattern to ANY document, and adds the cryptographic integrity check
 * B5 deferred — `contentHash` is the SHA-256 of the exact bytes shown to the signer at the
 * moment of signing, so a later substitution of the underlying file is detectable.
 */
export const documentSignature = pgTable(
  'document_signature',
  {
    id: uuid('id').primaryKey(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => storedFile.id),
    /** What is being signed — `acceptance_record`, `contract`, `dispatch_order`. */
    ...sourceReference(),
    signerUserId: uuid('signer_user_id'),
    signerName: text('signer_name').notNull(),
    signerRole: text('signer_role'),
    /** DRAWN | TYPED | CLICK — a drawn or typed signature carries an image/text signatureData;
     *  CLICK is the M16 portal-acceptance pattern generalised (no separate mark, the act of
     *  confirming IS the signature). */
    method: text('method').notNull(),
    signatureData: text('signature_data'),
    /** SHA-256 (hex) of the exact document bytes the signer was shown. */
    contentHash: text('content_hash').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    signedAt: instant('signed_at')
      .notNull()
      .default(sql`now()`),
    ...appendOnlyColumns(),
  },
  (t) => [
    index('idx_document_signature__source').on(t.sourceType, t.sourceId),
    index('idx_document_signature__file').on(t.fileId),
    check('ck_document_signature__method', sql`${t.method} in ('DRAWN','TYPED','CLICK')`),
  ],
)

/**
 * Version history for a logical document. `stored_file` rows are individually immutable
 * (never overwritten — see the module doc comment); this table is what lets a contract or
 * template be "the same document, edition 3" rather than an unrelated new upload each time.
 */
export const documentVersionHistory = pgTable(
  'document_version_history',
  {
    id: uuid('id').primaryKey(),
    /** The logical document this version belongs to — usually the FIRST version's file id,
     *  so the whole chain is discoverable from any one version. */
    documentGroupId: uuid('document_group_id').notNull(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => storedFile.id),
    versionNo: integer('version_no').notNull(),
    changeNote: text('change_note'),
    ...appendOnlyColumns(),
  },
  (t) => [
    uniqueIndex('uq_document_version_history__group_version').on(
      t.documentGroupId,
      t.versionNo,
    ),
    index('idx_document_version_history__file').on(t.fileId),
  ],
)

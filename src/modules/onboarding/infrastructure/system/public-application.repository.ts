import 'server-only'
import { randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { withServiceDb } from '@db/client'
import { uuidv7 } from '@core/ids/id-generator'
import { rawRows, col } from '@db/helpers/list-query'
import { systemClock } from '@core/clock/clock'
import { uploadFileWithRunner } from '@modules/files'
import { NotFoundError } from '@core/errors/app-error'
import {
  upsertApplicationDocument,
  updateApplicationDetails,
  insertApplicationMessage,
  transitionApplication,
  lockApplication,
} from '../application.repository'

/**
 * The public application path — a SANCTIONED service-role use.
 *
 * An applicant is genuinely anonymous. They have no JWT, no user row and no customer id, so
 * no RLS policy can identify them and `anon` deliberately holds no grants on
 * `customer_application` (a grant there would expose every applicant's TIN and licence to
 * anyone holding the anon key, which ships in the browser bundle by design).
 *
 * The only remaining option is a privileged path, confined to this file. It lives under
 * `infrastructure/system/` because that prefix is what scripts/guard-service-role.ts permits;
 * anywhere else and the build fails. See docs/adr/0013-supabase-as-platform.md.
 *
 * Two rules make that confinement safe:
 *
 *  1. Every function here touches ONLY `customer_application` and its children, and only for
 *     the one reference it was given. There is no general-purpose query surface.
 *  2. Reads return a NARROW projection. A reference is a locator, not a credential, so
 *     nothing here returns the reviewer's notes, the internal decision, or another applicant.
 */

const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000001'

/**
 * A public tracking reference.
 *
 * High-entropy, NOT sequential. A guessable reference would let anyone enumerate applications
 * and read one applicant's business details from another's URL — and the status page is the
 * one surface that accepts a reference alone as proof of anything.
 *
 * Format: APP-<year>-<20 base32 chars>, ~93 bits. Crockford alphabet, so a reference read
 * over the phone cannot be transcribed as 0/O or 1/I.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateApplicationReference(now: Date = systemClock.now()): string {
  const bytes = randomBytes(20)
  let token = ''
  for (const byte of bytes) {
    token += ALPHABET[byte % ALPHABET.length]
  }
  return `APP-${now.getUTCFullYear()}-${token}`
}

export interface SubmitApplicationInput {
  readonly branchId: string
  readonly legalName: string
  readonly tradeName?: string | undefined
  readonly businessTypeId?: string | undefined
  readonly tin?: string | undefined
  readonly businessLicenceNo?: string | undefined
  readonly regionId?: string | undefined
  readonly city?: string | undefined
  readonly contactName: string
  readonly contactPosition?: string | undefined
  readonly contactPhone: string
  readonly contactEmail: string
  readonly expectedAnnualVolumeKg?: string | undefined
  readonly primaryCoffeeTypeId?: string | undefined
  readonly intendedServices?: string | undefined
  /** For abuse investigation. Never displayed. */
  readonly submittedIp?: string | undefined
  /** KYC documents attached to the form itself — the applicant files them, not the reviewer. */
  readonly documents?: ReadonlyArray<{
    readonly documentTypeId: string
    readonly filename: string
    readonly content: Buffer
  }>
}

/**
 * Upload every attached document BEFORE the application row exists.
 *
 * `uploadFile`'s four phases are each their own transaction (I/O — scanning, storage —
 * cannot live inside one), so there is no single transaction to roll the application back
 * into if a file fails a scan. Uploading first means a rejected file fails the whole
 * submission cleanly, with nothing written to `customer_application` yet; the reverse order
 * would leave a half-created application on a bad upload. An upload that succeeds but is
 * never linked (the process dies before the application insert) leaves an orphaned PENDING
 * file — the same accepted failure mode `uploadFile` already tolerates elsewhere.
 */
async function uploadApplicationDocuments(
  applicationId: string,
  documents: SubmitApplicationInput['documents'],
): Promise<Array<{ documentTypeId: string; fileId: string }>> {
  const uploaded: Array<{ documentTypeId: string; fileId: string }> = []

  for (const doc of documents ?? []) {
    const file = await uploadFileWithRunner(
      (fn) =>
        withServiceDb(SYSTEM_ACTOR_ID, 'public application KYC document upload (M08)', fn),
      {
        filename: doc.filename,
        content: doc.content,
        sourceType: 'customer_application',
        sourceId: applicationId,
        category: 'KYC_DOCUMENT',
        actorId: SYSTEM_ACTOR_ID,
      },
    )
    uploaded.push({ documentTypeId: doc.documentTypeId, fileId: file.fileId })
  }

  return uploaded
}

/**
 * Record a submitted application, returning only its reference.
 *
 * The row is written as SUBMITTED rather than DRAFT: a public form has no resume path, so a
 * DRAFT here would be a row nobody can ever reach again.
 */
export async function submitPublicApplication(
  input: SubmitApplicationInput,
): Promise<{ reference: string }> {
  const id = uuidv7()
  const reference = generateApplicationReference()
  const now = systemClock.now()

  const uploadedDocuments = await uploadApplicationDocuments(id, input.documents)

  await withServiceDb(
    SYSTEM_ACTOR_ID,
    'public customer application submitted (M08 anonymous entry point)',
    async (tx) => {
      await tx.execute(sql`
        insert into public.customer_application (
          id, reference, branch_id,
          legal_name, trade_name, business_type_id, tin, business_licence_no,
          region_id, city,
          contact_name, contact_position, contact_phone, contact_email,
          expected_annual_volume_kg, primary_coffee_type_id, intended_services,
          status, submitted_at, submitted_ip,
          created_by, created_at, updated_at
        ) values (
          ${id}, ${reference}, ${input.branchId}::uuid,
          ${input.legalName}, ${input.tradeName ?? null},
          ${input.businessTypeId ?? null}::uuid, ${input.tin ?? null},
          ${input.businessLicenceNo ?? null},
          ${input.regionId ?? null}::uuid, ${input.city ?? null},
          ${input.contactName}, ${input.contactPosition ?? null},
          ${input.contactPhone}, ${input.contactEmail},
          ${input.expectedAnnualVolumeKg ?? null}::numeric,
          ${input.primaryCoffeeTypeId ?? null}::uuid,
          ${input.intendedServices ?? null},
          'SUBMITTED', ${now}, ${input.submittedIp ?? null},
          ${SYSTEM_ACTOR_ID}::uuid, ${now}, ${now}
        )
      `)

      await tx.execute(sql`
        insert into public.application_status_history (
          id, application_id, from_status, to_status, note, by_applicant, changed_at
        ) values (
          ${uuidv7()}, ${id}, null, 'SUBMITTED', 'Submitted through the public form', true, ${now}
        )
      `)

      for (const doc of uploadedDocuments) {
        await upsertApplicationDocument(tx, {
          applicationId: id,
          documentTypeId: doc.documentTypeId,
          fileId: doc.fileId,
          actorId: SYSTEM_ACTOR_ID,
        })
      }
    },
  )

  return { reference }
}

/**
 * The public status lookup.
 *
 * Returns only what an unauthenticated holder of the reference may see: where the application
 * has got to, and anything the reviewer has asked them for. Never the TIN, the licence, the
 * reviewer's identity or the internal decision note.
 */
export interface PublicStatus {
  readonly reference: string
  readonly legalName: string
  readonly status: string
  readonly submittedAt: Date | null
  readonly decidedAt: Date | null
  readonly infoRequested: string | null
}

export async function lookupApplicationStatus(
  reference: string,
): Promise<PublicStatus | undefined> {
  return withServiceDb(
    SYSTEM_ACTOR_ID,
    'public application status lookup by reference (M08)',
    async (tx) => {
      const rows = await rawRows(
        tx,
        sql`
          select reference, legal_name, status, submitted_at, decided_at, info_requested
          from public.customer_application
          where reference = ${reference}
          limit 1
        `,
      )

      const row = rows[0]
      if (!row) return undefined

      return {
        reference: col.text(row.reference),
        legalName: col.text(row.legal_name),
        status: col.text(row.status),
        submittedAt: col.dateOrNull(row.submitted_at),
        decidedAt: col.dateOrNull(row.decided_at),
        infoRequested: col.textOrNull(row.info_requested),
      }
    },
  )
}

/**
 * How many applications this address submitted recently.
 *
 * Crude but effective rate limiting for an unauthenticated write path: the constraint that
 * matters is not requests per second but one party filling the review queue with junk.
 */
export async function recentSubmissionCount(email: string, withinHours = 24): Promise<number> {
  return withServiceDb(
    SYSTEM_ACTOR_ID,
    'public application rate-limit check (M08)',
    async (tx) => {
      const rows = await rawRows(
        tx,
        sql`
          select count(*)::int as total
          from public.customer_application
          where contact_email = ${email}
            and created_at > now() - make_interval(hours => ${withinHours})
        `,
      )
      return rows[0] ? col.int(rows[0].total) : 0
    },
  )
}

/** Branches and business types the public form offers. Public reference data, nothing more. */
export interface PublicFormOptions {
  readonly branches: ReadonlyArray<{ id: string; name: string }>
  readonly businessTypes: ReadonlyArray<{ id: string; name: string }>
  readonly regions: ReadonlyArray<{ id: string; name: string }>
  readonly coffeeTypes: ReadonlyArray<{ id: string; name: string }>
}

export async function publicFormOptions(): Promise<PublicFormOptions> {
  return withServiceDb(
    SYSTEM_ACTOR_ID,
    'public application form reference data (M08)',
    async (tx) => {
      const read = async (table: string) => {
        const rows = await rawRows(
          tx,
          sql`
            select id, name_en from public.${sql.raw(table)}
            where is_active
            order by name_en
            limit 200
          `,
        )
        return rows.map((row) => ({ id: col.text(row.id), name: col.text(row.name_en) }))
      }

      const [branches, businessTypes, regions, coffeeTypes] = await Promise.all([
        read('branch'),
        read('business_type'),
        read('region'),
        read('coffee_type'),
      ])

      return { branches, businessTypes, regions, coffeeTypes }
    },
  )
}

/** One required KYC document, for one business type, on the public form. */
export interface PublicKycRequirement {
  readonly businessTypeId: string
  readonly documentTypeId: string
  readonly code: string
  readonly name: string
  readonly isMandatory: boolean
  readonly hasExpiry: boolean
}

/**
 * The KYC checklist for every business type, so the form can show only what a given
 * applicant needs the moment they pick their business type — public reference data, the
 * same requirement list a reviewer checks the submission against later.
 */
export async function publicKycRequirements(): Promise<readonly PublicKycRequirement[]> {
  return withServiceDb(
    SYSTEM_ACTOR_ID,
    'public application KYC checklist reference data (M08)',
    async (tx) => {
      const rows = await rawRows(
        tx,
        sql`
          select
            r.business_type_id, r.document_type_id, r.is_mandatory,
            t.code, t.name_en, t.has_expiry
          from public.kyc_document_requirement r
          join public.kyc_document_type t on t.id = r.document_type_id
          where t.is_active
          order by t.sort_order, t.name_en
        `,
      )

      return rows.map((row): PublicKycRequirement => ({
        businessTypeId: col.text(row.business_type_id),
        documentTypeId: col.text(row.document_type_id),
        code: col.text(row.code),
        name: col.text(row.name_en),
        isMandatory: col.bool(row.is_mandatory),
        hasExpiry: col.bool(row.has_expiry),
      }))
    },
  )
}

/**
 * The reply thread, by reference. Narrower than the staff read (`applicationMessages`): never
 * the sender's name — an applicant seeing a reviewer's identity is exactly the leak the rest
 * of this file's public projections are designed to avoid. A STAFF message is labelled
 * "EthioStar" by the UI, not by anything returned here.
 */
export interface PublicApplicationMessageRow {
  readonly id: string
  readonly senderKind: 'APPLICANT' | 'STAFF'
  readonly body: string
  readonly createdAt: Date
}

export async function publicApplicationMessages(
  reference: string,
): Promise<readonly PublicApplicationMessageRow[]> {
  return withServiceDb(
    SYSTEM_ACTOR_ID,
    'public application reply thread read by reference (M08)',
    async (tx) => {
      const rows = await rawRows(
        tx,
        sql`
          select m.id, m.sender_kind, m.body, m.created_at
          from public.application_message m
          join public.customer_application a on a.id = m.application_id
          where a.reference = ${reference}
          order by m.created_at asc
        `,
      )
      return rows.map((row) => ({
        id: col.text(row.id),
        senderKind: col.text(row.sender_kind) as 'APPLICANT' | 'STAFF',
        body: col.text(row.body),
        createdAt: col.date(row.created_at),
      }))
    },
  )
}

/**
 * The KYC checklist, by reference — same shape as the staff `applicationDocuments` query, cut
 * down to what an applicant needs to know which document to re-send: never the internal file
 * id or the storage status, only whether something is on file and what came of it.
 */
export interface PublicApplicationDocumentRow {
  readonly documentTypeId: string
  readonly name: string
  readonly isMandatory: boolean
  readonly originalFilename: string | null
  readonly verificationStatus: string | null
  readonly rejectionReason: string | null
}

export async function publicApplicationDocuments(
  reference: string,
): Promise<readonly PublicApplicationDocumentRow[]> {
  return withServiceDb(
    SYSTEM_ACTOR_ID,
    'public application KYC checklist read by reference (M08)',
    async (tx) => {
      const rows = await rawRows(
        tx,
        sql`
          with app as (
            select id, business_type_id from public.customer_application where reference = ${reference}
          ),
          required as (
            select r.document_type_id, r.is_mandatory
            from public.kyc_document_requirement r
            join app on app.business_type_id = r.business_type_id
          )
          select
            t.id as document_type_id, t.name_en, required.is_mandatory,
            f.original_filename, d.verification_status, d.rejection_reason
          from required
          join public.kyc_document_type t on t.id = required.document_type_id
          left join public.application_document d
            on d.document_type_id = required.document_type_id
           and d.application_id = (select id from app)
          left join public.stored_file f on f.id = d.file_id
          order by required.is_mandatory desc, t.sort_order, t.name_en
        `,
      )
      return rows.map((row) => ({
        documentTypeId: col.text(row.document_type_id),
        name: col.text(row.name_en),
        isMandatory: col.bool(row.is_mandatory),
        originalFilename: col.textOrNull(row.original_filename),
        verificationStatus: col.textOrNull(row.verification_status),
        rejectionReason: col.textOrNull(row.rejection_reason),
      }))
    },
  )
}

/**
 * The applicant's own editable fields, current values — so the reply form can pre-fill them
 * rather than asking the applicant to retype everything to change one. Same fields they
 * themselves supplied originally; nothing a reviewer added.
 */
export interface PublicApplicationDetails {
  readonly legalName: string
  readonly tradeName: string | null
  readonly contactName: string
  readonly contactPosition: string | null
  readonly contactPhone: string
  readonly contactEmail: string
  readonly tin: string | null
  readonly businessLicenceNo: string | null
  readonly intendedServices: string | null
  readonly branchId: string
  readonly businessTypeId: string | null
  readonly regionId: string | null
  readonly city: string | null
  readonly expectedAnnualVolumeKg: string | null
  readonly primaryCoffeeTypeId: string | null
}

export async function publicApplicationDetails(
  reference: string,
): Promise<PublicApplicationDetails | undefined> {
  return withServiceDb(
    SYSTEM_ACTOR_ID,
    'public application editable details read by reference (M08)',
    async (tx) => {
      const rows = await rawRows(
        tx,
        sql`
          select legal_name, trade_name, contact_name, contact_position, contact_phone,
                 contact_email, tin, business_licence_no, intended_services,
                 branch_id, business_type_id, region_id, city,
                 expected_annual_volume_kg, primary_coffee_type_id
          from public.customer_application
          where reference = ${reference}
          limit 1
        `,
      )
      const row = rows[0]
      if (!row) return undefined
      return {
        legalName: col.text(row.legal_name),
        tradeName: col.textOrNull(row.trade_name),
        contactName: col.text(row.contact_name),
        contactPosition: col.textOrNull(row.contact_position),
        contactPhone: col.text(row.contact_phone),
        contactEmail: col.text(row.contact_email),
        tin: col.textOrNull(row.tin),
        businessLicenceNo: col.textOrNull(row.business_licence_no),
        intendedServices: col.textOrNull(row.intended_services),
        branchId: col.text(row.branch_id),
        businessTypeId: col.textOrNull(row.business_type_id),
        regionId: col.textOrNull(row.region_id),
        city: col.textOrNull(row.city),
        expectedAnnualVolumeKg: row.expected_annual_volume_kg ? String(row.expected_annual_volume_kg) : null,
        primaryCoffeeTypeId: col.textOrNull(row.primary_coffee_type_id),
      }
    },
  )
}

/**
 * How many replies this application's thread has received recently.
 *
 * Same crude-but-effective reasoning as `recentSubmissionCount`, applied to the second
 * unauthenticated write surface this file now exposes.
 */
export async function recentReplyCount(reference: string, withinHours = 24): Promise<number> {
  return withServiceDb(
    SYSTEM_ACTOR_ID,
    'public application reply rate-limit check (M08)',
    async (tx) => {
      const rows = await rawRows(
        tx,
        sql`
          select count(*)::int as total
          from public.application_message m
          join public.customer_application a on a.id = m.application_id
          where a.reference = ${reference}
            and m.sender_kind = 'APPLICANT'
            and m.created_at > now() - make_interval(hours => ${withinHours})
        `,
      )
      return rows[0] ? col.int(rows[0].total) : 0
    },
  )
}

export interface ApplicantReplyInput {
  readonly reference: string
  readonly message: string
  readonly legalName?: string | undefined
  readonly tradeName?: string | undefined
  readonly contactName?: string | undefined
  readonly contactPosition?: string | undefined
  readonly contactPhone?: string | undefined
  readonly contactEmail?: string | undefined
  readonly tin?: string | undefined
  readonly businessLicenceNo?: string | undefined
  readonly intendedServices?: string | undefined
  readonly branchId?: string | undefined
  readonly businessTypeId?: string | undefined
  readonly regionId?: string | undefined
  readonly city?: string | undefined
  readonly expectedAnnualVolumeKg?: string | undefined
  readonly primaryCoffeeTypeId?: string | undefined
  readonly documents?: ReadonlyArray<{
    readonly documentTypeId: string
    readonly filename: string
    readonly content: Buffer
  }>
}

async function findReplyTarget(
  reference: string,
): Promise<{ id: string; status: string } | undefined> {
  return withServiceDb(
    SYSTEM_ACTOR_ID,
    'public application reply target lookup by reference (M08)',
    async (tx) => {
      const rows = await rawRows(
        tx,
        sql`select id, status from public.customer_application where reference = ${reference} limit 1`,
      )
      const row = rows[0]
      if (!row) return undefined
      return { id: col.text(row.id), status: col.text(row.status) }
    },
  )
}

/**
 * The applicant's reply to an info request: an optional set of corrected details, any
 * re-uploaded documents, and a message — submitted together as one action, and together they
 * put the application back in front of a reviewer (INFO_REQUESTED -> UNDER_REVIEW).
 *
 * Only accepted while the application is pre-decision (SUBMITTED, UNDER_REVIEW, INFO_REQUESTED).
 */
export async function submitApplicantReply(input: ApplicantReplyInput): Promise<void> {
  const target = await findReplyTarget(input.reference)
  if (
    !target ||
    (target.status !== 'INFO_REQUESTED' &&
      target.status !== 'UNDER_REVIEW' &&
      target.status !== 'SUBMITTED')
  ) {
    throw NotFoundError.of('Application', input.reference)
  }

  const uploadedDocuments = await uploadApplicationDocuments(target.id, input.documents)

  await withServiceDb(
    SYSTEM_ACTOR_ID,
    'public application applicant reply (M08)',
    async (tx) => {
      const header = await lockApplication(tx, target.id)
      if (
        header.status !== 'INFO_REQUESTED' &&
        header.status !== 'UNDER_REVIEW' &&
        header.status !== 'SUBMITTED'
      ) {
        throw NotFoundError.of('Application', input.reference)
      }

      await updateApplicationDetails(
        tx,
        target.id,
        {
          legalName: input.legalName,
          tradeName: input.tradeName,
          contactName: input.contactName,
          contactPosition: input.contactPosition,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail,
          tin: input.tin,
          businessLicenceNo: input.businessLicenceNo,
          intendedServices: input.intendedServices,
          branchId: input.branchId,
          businessTypeId: input.businessTypeId,
          regionId: input.regionId,
          city: input.city,
          expectedAnnualVolumeKg: input.expectedAnnualVolumeKg,
          primaryCoffeeTypeId: input.primaryCoffeeTypeId,
        },
        SYSTEM_ACTOR_ID,
      )

      for (const doc of uploadedDocuments) {
        await upsertApplicationDocument(tx, {
          applicationId: target.id,
          documentTypeId: doc.documentTypeId,
          fileId: doc.fileId,
          actorId: SYSTEM_ACTOR_ID,
        })
      }

      await insertApplicationMessage(tx, {
        applicationId: target.id,
        senderKind: 'APPLICANT',
        senderUserId: null,
        body: input.message,
        actorId: SYSTEM_ACTOR_ID,
      })

      if (header.status !== 'UNDER_REVIEW') {
        await transitionApplication(tx, header.status, {
          id: target.id,
          to: 'UNDER_REVIEW',
          actorId: SYSTEM_ACTOR_ID,
          byApplicant: true,
          note: input.message,
        })
      }
    },
  )
}

import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

/**
 * Admin CRUD for `document_template` — layout metadata rows for the printed documents
 * (goods receipts, gate passes, acceptances, delivery notes, coffee passports, labels), not
 * the react-pdf renderers themselves. A template edit is a NEW `templateVersion` row for the
 * same `code` + `locale`, never an in-place update of a version already in use — see the
 * table's `uq_document_template__key` unique index.
 */

export interface DocumentTemplateAdminRow {
  readonly id: string
  readonly code: string
  readonly documentType: string
  readonly templateVersion: number
  readonly locale: string
  readonly title: string
  readonly layout: unknown
  readonly pageSize: string
  readonly isActive: boolean
}

export async function listDocumentTemplates(tx: Tx): Promise<DocumentTemplateAdminRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, document_type, template_version, locale, title, layout, page_size,
             is_active
      from public.document_template
      order by document_type, code, locale, template_version desc
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    documentType: col.text(row.document_type),
    templateVersion: col.int(row.template_version),
    locale: col.text(row.locale),
    title: col.text(row.title),
    layout: row.layout ?? null,
    pageSize: col.text(row.page_size),
    isActive: col.bool(row.is_active),
  }))
}

export interface CreateDocumentTemplateInput {
  readonly code: string
  readonly documentType: string
  readonly locale: string
  readonly title: string
  readonly layout: unknown
  readonly pageSize: string
  readonly actorId: string
}

/**
 * Inserts the next `templateVersion` for `code` + `locale` — 1 for a brand-new code, or the
 * current highest version + 1, so a published template is never overwritten in place.
 */
export async function createDocumentTemplate(
  tx: Tx,
  input: CreateDocumentTemplateInput,
): Promise<void> {
  await tx.execute(sql`
    insert into public.document_template (
      id, code, document_type, template_version, locale, title, layout, page_size,
      is_active, created_by, created_at, updated_at
    )
    select
      ${uuidv7()}, ${input.code}, ${input.documentType},
      coalesce(
        (select max(template_version) + 1
         from public.document_template
         where code = ${input.code} and locale = ${input.locale}),
        1
      ),
      ${input.locale}, ${input.title}, ${input.layout ? JSON.stringify(input.layout) : null}::jsonb,
      ${input.pageSize}, true, ${input.actorId}::uuid, now(), now()
  `)
}

export async function setDocumentTemplateActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.document_template
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}

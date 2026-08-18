import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'

/**
 * Admin CRUD for `notification_template`. The read side used at send time is
 * `resolveTemplate` in `notification.repository.ts`; this file is the write side used only by
 * the admin screen. As with document templates, an edit is a NEW `templateVersion` row for
 * the same `code` + `channel` + `locale`, never an in-place update — see
 * `uq_notification_template__key`.
 */

export interface NotificationTemplateAdminRow {
  readonly id: string
  readonly code: string
  readonly channel: string
  readonly templateVersion: number
  readonly locale: string
  readonly subject: string | null
  readonly body: string
  readonly variables: unknown
  readonly isActive: boolean
}

export async function listNotificationTemplates(
  tx: Tx,
): Promise<NotificationTemplateAdminRow[]> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, channel, template_version, locale, subject, body, variables, is_active
      from public.notification_template
      order by code, channel, locale, template_version desc
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    code: col.text(row.code),
    channel: col.text(row.channel),
    templateVersion: col.int(row.template_version),
    locale: col.text(row.locale),
    subject: col.textOrNull(row.subject),
    body: col.text(row.body),
    variables: row.variables ?? null,
    isActive: col.bool(row.is_active),
  }))
}

export interface CreateNotificationTemplateInput {
  readonly code: string
  readonly channel: string
  readonly locale: string
  readonly subject: string | null
  readonly body: string
  readonly variables: unknown
  readonly actorId: string
}

/**
 * Inserts the next `templateVersion` for `code` + `channel` + `locale` — 1 for a brand-new
 * combination, or the current highest version + 1.
 */
export async function createNotificationTemplate(
  tx: Tx,
  input: CreateNotificationTemplateInput,
): Promise<void> {
  await tx.execute(sql`
    insert into public.notification_template (
      id, code, channel, template_version, locale, subject, body, variables,
      is_active, created_by, created_at, updated_at
    )
    select
      ${uuidv7()}, ${input.code}, ${input.channel},
      coalesce(
        (select max(template_version) + 1
         from public.notification_template
         where code = ${input.code} and channel = ${input.channel} and locale = ${input.locale}),
        1
      ),
      ${input.locale}, ${input.subject}, ${input.body},
      ${input.variables ? JSON.stringify(input.variables) : null}::jsonb,
      true, ${input.actorId}::uuid, now(), now()
  `)
}

export async function setNotificationTemplateActive(
  tx: Tx,
  id: string,
  isActive: boolean,
  actorId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.notification_template
    set is_active = ${isActive}, updated_at = now(), updated_by = ${actorId}::uuid,
        version = version + 1
    where id = ${id}::uuid
  `)
}

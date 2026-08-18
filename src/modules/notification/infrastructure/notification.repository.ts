import 'server-only'
import { sql } from 'drizzle-orm'
import type { Tx } from '@db/client'
import { rawRows, col } from '@db/helpers/list-query'
import { uuidv7 } from '@core/ids/id-generator'
import { DEFAULT_LOCALE, type Locale } from '@config/constants'
import type { TemplateSource } from '../domain/template'

/**
 * M04 persistence. Every function takes `tx` — repositories never open their own
 * transaction, because queuing a notification must be atomic with the change that caused it.
 */

export type Channel = 'EMAIL' | 'SMS' | 'IN_APP'

export interface ResolvedTemplate extends TemplateSource {
  readonly id: string
  readonly templateVersion: number
  readonly locale: Locale
}

/**
 * Find the template to render.
 *
 * Picks the HIGHEST active `template_version`, which is what "templates are versioned and
 * published deliberately" means in practice: editing a template creates a new version, and
 * messages already sent keep the body they were rendered with.
 *
 * Falls back to the default locale when the requested one has no template. An Amharic
 * translation that has not been written yet must not mean the customer is told nothing —
 * silence is the failure mode M04 exists to prevent.
 */
export async function resolveTemplate(
  tx: Tx,
  code: string,
  channel: Channel,
  locale: Locale,
): Promise<ResolvedTemplate | undefined> {
  const rows = await rawRows(
    tx,
    sql`
      select id, code, subject, body, template_version, locale
      from public.notification_template
      where code = ${code}
        and channel = ${channel}
        and locale in (${locale}, ${DEFAULT_LOCALE})
        and is_active
      -- Requested locale first, then the fallback; newest published version within each.
      order by (locale = ${locale}) desc, template_version desc
      limit 1
    `,
  )

  const row = rows[0]
  if (!row) return undefined

  return {
    id: col.text(row.id),
    code: col.text(row.code),
    subject: col.textOrNull(row.subject),
    body: col.text(row.body),
    templateVersion: col.int(row.template_version),
    locale: col.text(row.locale) as Locale,
  }
}

export interface NotificationRow {
  readonly templateId: string | null
  readonly templateCode: string
  readonly channel: Channel
  readonly locale: Locale
  readonly recipientUserId?: string | null
  readonly recipientCustomerId?: string | null
  readonly recipientAddress?: string | null
  readonly subject: string | null
  readonly renderedBody: string
  readonly payload: Readonly<Record<string, unknown>>
  readonly sourceType?: string | null
  readonly sourceId?: string | null
  readonly correlationId?: string | null
  readonly priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  readonly actorId: string | null
}

/** Insert a PENDING notification. The worker picks it up after commit. */
export async function insertNotification(tx: Tx, row: NotificationRow): Promise<string> {
  const id = uuidv7()

  await tx.execute(sql`
    insert into public.notification (
      id, template_id, template_code, channel, locale,
      recipient_user_id, recipient_customer_id, recipient_address,
      subject, rendered_body, payload,
      source_type, source_id, correlation_id,
      status, priority,
      created_by, created_at, updated_at
    ) values (
      ${id}, ${row.templateId}::uuid, ${row.templateCode}, ${row.channel}, ${row.locale},
      ${row.recipientUserId ?? null}::uuid, ${row.recipientCustomerId ?? null}::uuid,
      ${row.recipientAddress ?? null},
      ${row.subject}, ${row.renderedBody}, ${JSON.stringify(row.payload)}::jsonb,
      ${row.sourceType ?? null}, ${row.sourceId ?? null}::uuid,
      ${row.correlationId ?? null}::uuid,
      'PENDING', ${row.priority ?? 'NORMAL'},
      ${row.actorId}::uuid, now(), now()
    )
  `)

  return id
}

export interface PendingNotification {
  readonly id: string
  readonly channel: Channel
  readonly recipientAddress: string | null
  readonly subject: string | null
  readonly renderedBody: string
  readonly attemptCount: number
}

/**
 * Claim a batch for sending.
 *
 * `FOR UPDATE SKIP LOCKED` plus an immediate move to SENDING is what makes two worker
 * instances safe: the second sees no PENDING row for the same notification, so a customer
 * does not receive the same credential letter twice.
 */
export async function claimPendingNotifications(
  tx: Tx,
  batchSize: number,
): Promise<PendingNotification[]> {
  const rows = await rawRows(
    tx,
    sql`
      update public.notification n
      set status = 'SENDING', updated_at = now()
      where n.id in (
        select id from public.notification
        where status = 'PENDING'
          and (scheduled_for is null or scheduled_for <= now())
        order by
          case priority when 'URGENT' then 0 when 'HIGH' then 1 when 'NORMAL' then 2 else 3 end,
          created_at
        for update skip locked
        limit ${batchSize}
      )
      returning n.id, n.channel, n.recipient_address, n.subject, n.rendered_body, n.attempt_count
    `,
  )

  return rows.map((row) => ({
    id: col.text(row.id),
    channel: col.text(row.channel) as Channel,
    recipientAddress: col.textOrNull(row.recipient_address),
    subject: col.textOrNull(row.subject),
    renderedBody: col.text(row.rendered_body),
    attemptCount: col.int(row.attempt_count),
  }))
}

export async function markNotificationSent(
  tx: Tx,
  id: string,
  providerMessageId: string,
): Promise<void> {
  await tx.execute(sql`
    update public.notification
    set status = 'SENT',
        sent_at = now(),
        provider_message_id = ${providerMessageId},
        attempt_count = attempt_count + 1,
        updated_at = now()
    where id = ${id}
  `)
}

/**
 * Record a failed attempt.
 *
 * Below `maxAttempts` the row returns to PENDING for another pass. At the limit it becomes
 * FAILED, which is a permanent record that a customer was not told something — the schema's
 * check constraint requires the reason, so that record can never be a bare status.
 */
export async function markNotificationFailed(
  tx: Tx,
  id: string,
  reason: string,
  attemptCount: number,
  maxAttempts: number,
): Promise<'RETRY' | 'FAILED'> {
  const exhausted = attemptCount + 1 >= maxAttempts

  if (exhausted) {
    await tx.execute(sql`
      update public.notification
      set status = 'FAILED',
          failed_at = now(),
          failure_reason = ${reason},
          attempt_count = attempt_count + 1,
          updated_at = now()
      where id = ${id}
    `)
    return 'FAILED'
  }

  await tx.execute(sql`
    update public.notification
    set status = 'PENDING',
        failure_reason = ${reason},
        attempt_count = attempt_count + 1,
        -- Back off so a dead SMTP host is not hammered by every poll cycle.
        scheduled_for = now() + make_interval(secs => ${2 ** (attemptCount + 1) * 15}),
        updated_at = now()
    where id = ${id}
  `)
  return 'RETRY'
}

/** Notifications that permanently failed — surfaced on the admin delivery log. */
export async function failedNotificationCount(tx: Tx, withinHours = 24): Promise<number> {
  const rows = await rawRows(
    tx,
    sql`
      select count(*)::int as total
      from public.notification
      where status = 'FAILED'
        and failed_at > now() - make_interval(hours => ${withinHours})
    `,
  )
  return rows[0] ? col.int(rows[0].total) : 0
}

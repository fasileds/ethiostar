import {
  pgTable,
  text,
  uuid,
  index,
  uniqueIndex,
  check,
  integer,
  boolean,
  jsonb,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  auditColumns,
  activeFlag,
  instant,
  sourceReference,
  correlationColumns,
} from '../helpers/columns'

/**
 * M04 — Notification & Alert Management.
 *
 * A notification is QUEUED inside the business transaction and SENT by a worker afterwards.
 * Sending inline would mean an SMS gateway timeout rolling back a goods receipt, and an SMS
 * that went out for a transaction that then rolled back.
 *
 * Templates are versioned and rendered at send time so the message a customer received can
 * be reconstructed exactly, months later, from `renderedBody`.
 */

export const notificationTemplate = pgTable(
  'notification_template',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    /** EMAIL | SMS | IN_APP */
    channel: text('channel').notNull(),
    /** Distinct from auditColumns().version — this is the TEMPLATE revision, published
     * deliberately, not the optimistic-concurrency counter. */
    templateVersion: integer('template_version').notNull().default(1),
    locale: text('locale').notNull().default('en'),
    subject: text('subject'),
    body: text('body').notNull(),
    /** Documented placeholders, so an editor knows what is available. */
    variables: jsonb('variables'),
    description: text('description'),
    isActive: activeFlag(),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_notification_template__key').on(
      t.code,
      t.channel,
      t.locale,
      t.templateVersion,
    ),
    index('idx_notification_template__code').on(t.code, t.isActive),
    check('ck_notification_template__channel', sql`${t.channel} in ('EMAIL','SMS','IN_APP')`),
    check('ck_notification_template__locale', sql`${t.locale} in ('en','am')`),
  ],
)

export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey(),
    templateId: uuid('template_id').references(() => notificationTemplate.id),
    templateCode: text('template_code'),
    channel: text('channel').notNull(),
    locale: text('locale').notNull().default('en'),

    /** Exactly one of these identifies the audience. */
    recipientUserId: uuid('recipient_user_id'),
    recipientCustomerId: uuid('recipient_customer_id'),
    recipientAddress: text('recipient_address'),

    subject: text('subject'),
    /** Rendered at send time and kept. This is the message that was actually delivered. */
    renderedBody: text('rendered_body').notNull(),
    payload: jsonb('payload'),

    /** PENDING → SENDING → SENT → DELIVERED | FAILED | CANCELLED */
    status: text('status').notNull().default('PENDING'),
    priority: text('priority').notNull().default('NORMAL'),

    /** Not before this instant — quiet hours, batching. */
    scheduledFor: instant('scheduled_for'),
    sentAt: instant('sent_at'),
    deliveredAt: instant('delivered_at'),
    readAt: instant('read_at'),
    failedAt: instant('failed_at'),
    failureReason: text('failure_reason'),
    attemptCount: integer('attempt_count').notNull().default(0),
    /** Gateway message id, for reconciling a delivery report. */
    providerMessageId: text('provider_message_id'),

    ...sourceReference(),
    ...correlationColumns(),
    ...auditColumns(),
  },
  (t) => [
    // The worker's claim query. Partial so it stays small as the table grows without bound.
    index('idx_notification__pending')
      .on(t.scheduledFor)
      .where(sql`${t.status} = 'PENDING'`),
    index('idx_notification__recipient_user').on(t.recipientUserId, t.createdAt),
    index('idx_notification__recipient_customer').on(t.recipientCustomerId, t.createdAt),
    index('idx_notification__source').on(t.sourceType, t.sourceId),
    index('idx_notification__correlation').on(t.correlationId),
    check(
      'ck_notification__status',
      sql`${t.status} in ('PENDING','SENDING','SENT','DELIVERED','FAILED','CANCELLED')`,
    ),
    check('ck_notification__channel', sql`${t.channel} in ('EMAIL','SMS','IN_APP')`),
    check('ck_notification__priority', sql`${t.priority} in ('LOW','NORMAL','HIGH','URGENT')`),
    // Something has to say who this is for.
    check(
      'ck_notification__has_recipient',
      sql`${t.recipientUserId} is not null or ${t.recipientCustomerId} is not null or ${t.recipientAddress} is not null`,
    ),
    // A failure must record why, or the retry logic is operating blind.
    check(
      'ck_notification__failure_reason',
      sql`${t.status} <> 'FAILED' or ${t.failureReason} is not null`,
    ),
  ],
)

/**
 * Per-user channel preferences.
 *
 * Absence of a row means the system default applies. Storing an explicit row for every user
 * and every event type would be thousands of rows nobody reads.
 */
export const notificationPreference = pgTable(
  'notification_preference',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id'),
    customerId: uuid('customer_id'),
    /** Event class this preference covers, e.g. 'delivery_request.approved'. */
    eventType: text('event_type').notNull(),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    smsEnabled: boolean('sms_enabled').notNull().default(false),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
    ...auditColumns(),
  },
  (t) => [
    uniqueIndex('uq_notification_preference__user').on(t.userId, t.eventType),
    uniqueIndex('uq_notification_preference__customer').on(t.customerId, t.eventType),
    check(
      'ck_notification_preference__subject',
      sql`${t.userId} is not null or ${t.customerId} is not null`,
    ),
  ],
)

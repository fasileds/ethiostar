/**
 * M04 — Notification & Communication.
 *
 * "Keeps customers and staff informed automatically, and forms the audit record of what
 * EthioStar told a customer and when — which is the evidence that matters when a customer
 * claims they were not informed of a delay."
 *
 * Key control: notifications are never deleted; the log is an evidentiary record. Enforced
 * by an append-only trigger and a REVOKE that names `service_role`, not by convention.
 */

export {
  queueNotification,
  type QueueNotificationInput,
} from './application/queue-notification'
export { queueNotificationForEvent } from './application/queue-notification-for-event'

export {
  render,
  placeholdersOf,
  type TemplateSource,
  type RenderedMessage,
  type TemplateVariables,
} from './domain/template'

export {
  resolveTemplate,
  insertNotification,
  claimPendingNotifications,
  markNotificationSent,
  markNotificationFailed,
  failedNotificationCount,
  type Channel,
  type ResolvedTemplate,
  type PendingNotification,
} from './infrastructure/notification.repository'

export { NOTIFICATION_TEMPLATES, type NotificationTemplateCode } from './domain/template-codes'

export {
  listNotificationTemplates,
  createNotificationTemplate,
  setNotificationTemplateActive,
  type NotificationTemplateAdminRow,
  type CreateNotificationTemplateInput,
} from './infrastructure/notification-template-admin.repository'

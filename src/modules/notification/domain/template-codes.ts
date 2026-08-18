/**
 * The event-driven triggers M04 names, as stable template codes.
 *
 * Solution Overview §5, M04: "application received, application approved or rejected,
 * document expiring, delivery request approved, coffee received at gate, storage confirmed,
 * appointment scheduled, appointment changed or delayed, processing started, processing
 * completed, output ready for acceptance, Mirt Merekebiya awaiting signature, dispatch
 * scheduled, gate pass issued, invoice raised, payment received, payment overdue."
 *
 * The three billing codes at the end belong to Phase 2 (M19) and are deliberately absent —
 * a code declared here with no template seeded would fail closed at send time, which is the
 * behaviour we want, but listing it would imply the feature exists.
 *
 * TREAT AS APPEND-ONLY. Renaming a code strands the seeded template rows, and every message
 * of that kind then fails to resolve.
 */
export const NOTIFICATION_TEMPLATES = {
  // M08 — onboarding
  APPLICATION_RECEIVED: 'APPLICATION_RECEIVED',
  APPLICATION_APPROVED: 'APPLICATION_APPROVED',
  APPLICATION_REJECTED: 'APPLICATION_REJECTED',
  APPLICATION_INFO_REQUESTED: 'APPLICATION_INFO_REQUESTED',
  /** The Stage 1 requirement: credentials issued automatically on approval. */
  CUSTOMER_CREDENTIALS_ISSUED: 'CUSTOMER_CREDENTIALS_ISSUED',
  DOCUMENT_EXPIRING: 'DOCUMENT_EXPIRING',

  // M11 — inbound
  DELIVERY_REQUEST_APPROVED: 'DELIVERY_REQUEST_APPROVED',
  DELIVERY_REQUEST_REJECTED: 'DELIVERY_REQUEST_REJECTED',
  COFFEE_RECEIVED: 'COFFEE_RECEIVED',
  STORAGE_CONFIRMED: 'STORAGE_CONFIRMED',

  // M14 — scheduling
  PROCESSING_REQUEST_APPROVED: 'PROCESSING_REQUEST_APPROVED',
  PROCESSING_REQUEST_REJECTED: 'PROCESSING_REQUEST_REJECTED',
  APPOINTMENT_SCHEDULED: 'APPOINTMENT_SCHEDULED',
  /** Stage 3's explicit requirement: the customer is told the new date and the reason. */
  APPOINTMENT_DELAYED: 'APPOINTMENT_DELAYED',
  APPOINTMENT_CANCELLED: 'APPOINTMENT_CANCELLED',

  // M15 / M16 — processing and acceptance
  PROCESSING_STARTED: 'PROCESSING_STARTED',
  PROCESSING_COMPLETED: 'PROCESSING_COMPLETED',
  OUTPUT_READY_FOR_ACCEPTANCE: 'OUTPUT_READY_FOR_ACCEPTANCE',
  ACCEPTANCE_AWAITING_SIGNATURE: 'ACCEPTANCE_AWAITING_SIGNATURE',

  // M17 — dispatch
  DISPATCH_SCHEDULED: 'DISPATCH_SCHEDULED',
  GATE_PASS_ISSUED: 'GATE_PASS_ISSUED',

  // M12 — warehouse
  CAPACITY_THRESHOLD_REACHED: 'CAPACITY_THRESHOLD_REACHED',
} as const

export type NotificationTemplateCode =
  (typeof NOTIFICATION_TEMPLATES)[keyof typeof NOTIFICATION_TEMPLATES]

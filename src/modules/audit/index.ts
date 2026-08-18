/**
 * M07 — Audit Trail, Compliance & Traceability.
 *
 * "Records everything that happens, permanently, so that any quantity, any weight and any
 * decision can be explained months later. This is the module that protects EthioStar in a
 * dispute."
 */

export {
  appendEvents,
  claimOutboxBatch,
  markPublished,
  markFailed,
  outboxLagSeconds,
  type AppendOptions,
} from './infrastructure/event-store'

export {
  coffeePassport,
  entityHistory,
  type PassportEntry,
  type PassportEntryKind,
} from './application/coffee-passport.query'

export {
  listAuditLog,
  auditEntityTypes,
  listDomainEvents,
  outboxHealth,
  type AuditRow,
  type DomainEventRow,
} from './application/audit.query'

export { publishEvents } from './application/publish-events'

export {
  onEventInline,
  onEvent,
  inlineHandlersFor,
  deferredHandlersFor,
  subscribedEventNames,
  describeSubscriptions,
  __resetRegistry,
  type InlineHandler,
  type DeferredHandler,
} from './infrastructure/event-registry'

import 'server-only'
import type { Tx } from '@db/client'
import type { DomainEventEnvelope } from '@core/domain/domain-event'

/**
 * The event subscription registry — how modules stay decoupled.
 *
 * Lives in `audit` (tier 1) rather than under `@server`, DELIBERATELY: the boundary rules
 * that keep `inbound` from importing `notification` directly are the same rules that would
 * stop `notification` from importing a registry under `@server`, since modules may not
 * import the `server` tier at all. Tier 1 is importable from every module, so this is where
 * the mechanism that makes cross-module decoupling possible has to sit.
 *
 * `inbound` must not import `notification`, or the dependency graph inverts and Phase 2
 * billing becomes a code change in every emitting module. Instead `inbound` emits
 * `ConsignmentReceived` (by name, via `publishEvents`), and `notification` subscribes to
 * that name without importing `inbound`.
 *
 * TWO KINDS OF HANDLER, and the distinction matters:
 *
 *   INLINE       runs in the SAME transaction as the business change. For effects that
 *                must be atomic with it: the lifecycle transition, the stock ledger.
 *                A failure rolls the whole operation back.
 *
 *   DEFERRED     runs from the outbox, after commit, in the worker. For effects that must
 *                not block the operation: email, PDF rendering, external calls.
 *                Delivery is AT-LEAST-ONCE, so these MUST be idempotent.
 *
 * docs/architecture/01-principles-and-layering.md §1.3
 */

export type InlineHandler = (event: DomainEventEnvelope, tx: Tx) => Promise<void>

export type DeferredHandler = (event: DomainEventEnvelope) => Promise<void>

interface Registration<THandler> {
  readonly module: string
  readonly handler: THandler
}

const inlineHandlers = new Map<string, Array<Registration<InlineHandler>>>()
const deferredHandlers = new Map<string, Array<Registration<DeferredHandler>>>()

/**
 * Subscribe a handler that runs inside the emitting transaction.
 * Use sparingly — only where the effect must be atomic with the business change.
 */
export function onEventInline(eventName: string, module: string, handler: InlineHandler): void {
  const existing = inlineHandlers.get(eventName) ?? []
  existing.push({ module, handler })
  inlineHandlers.set(eventName, existing)
}

/**
 * Subscribe a handler that runs after commit, from the outbox.
 *
 * MUST be idempotent: at-least-once delivery is the contract, and pretending otherwise
 * produces duplicate emails to customers.
 */
export function onEvent(eventName: string, module: string, handler: DeferredHandler): void {
  const existing = deferredHandlers.get(eventName) ?? []
  existing.push({ module, handler })
  deferredHandlers.set(eventName, existing)
}

export function inlineHandlersFor(
  eventName: string,
): ReadonlyArray<Registration<InlineHandler>> {
  return inlineHandlers.get(eventName) ?? []
}

export function deferredHandlersFor(
  eventName: string,
): ReadonlyArray<Registration<DeferredHandler>> {
  return deferredHandlers.get(eventName) ?? []
}

/** Every event name with at least one subscriber — used by a startup coverage check. */
export function subscribedEventNames(): string[] {
  return [...new Set([...inlineHandlers.keys(), ...deferredHandlers.keys()])].sort()
}

/** Subscription map for diagnostics and the admin console. */
export function describeSubscriptions(): Record<
  string,
  { inline: string[]; deferred: string[] }
> {
  const output: Record<string, { inline: string[]; deferred: string[] }> = {}
  for (const name of subscribedEventNames()) {
    output[name] = {
      inline: inlineHandlersFor(name).map((r) => r.module),
      deferred: deferredHandlersFor(name).map((r) => r.module),
    }
  }
  return output
}

/** Test isolation only. */
export function __resetRegistry(): void {
  inlineHandlers.clear()
  deferredHandlers.clear()
}

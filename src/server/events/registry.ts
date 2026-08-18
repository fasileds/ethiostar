/**
 * Compatibility re-export.
 *
 * The registry itself moved to `@modules/audit/infrastructure/event-registry.ts` — modules
 * cannot import the `server` tier, so a registry that modules need to register subscriptions
 * into cannot live here. It sits in `audit` (tier 1), importable from every module.
 *
 * This file stays so `worker/` (which IS allowed to import `server`) keeps a stable import
 * path, and to avoid rewriting every existing reference for a move that is purely about
 * which tier owns the file.
 */
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
} from '@modules/audit'

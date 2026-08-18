/**
 * Compatibility re-export — see `registry.ts` in this directory for why.
 *
 * `publishEvents` lives in `@modules/audit` so every module tier can call it; this keeps a
 * `server`-tier path available for worker code that wants the same name without reaching
 * into `@modules/audit` directly.
 */
export { publishEvents as publish } from '@modules/audit'

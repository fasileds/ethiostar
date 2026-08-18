import type { Tx } from '../../src/db/client'

/** Context handed to every seed step. */
export interface SeedContext {
  readonly tx: Tx
  /** Structured progress output. Seeds run in CI, so their log is a test artefact. */
  readonly log: (message: string) => void
  /** True when `--demo` was passed. Demo seeds refuse to run in production. */
  readonly includeDemo: boolean
}

export type SeedStep = (ctx: SeedContext) => Promise<void>

/**
 * M16 — Mirt Merekebiya (Customer Output Acceptance).
 *
 * The commercial hinge. A signed acceptance is immutable; a correction supersedes it.
 */

export {
  listAcceptances,
  acceptanceStatusCounts,
  findAcceptance,
  acceptanceLines,
  type AcceptanceRow,
  type AcceptanceDetail,
  type AcceptanceLineRow,
} from './application/acceptance.query'

export {
  ACCEPTANCE_STATUSES,
  ACCEPTANCE_TRANSITIONS,
  acceptanceStateMachine,
  type AcceptanceStatus,
} from './domain/acceptance-status'

export { issueAcceptancePack, signAcceptance } from './application/issue-and-sign'

export type { SignAcceptanceInput } from './infrastructure/acceptance.repository'

export {
  loadMirtMerekebiyaSnapshot,
  type MirtMerekebiyaSnapshot,
  type MirtMerekebiyaOutputLine,
} from './application/acceptance-print-snapshot'

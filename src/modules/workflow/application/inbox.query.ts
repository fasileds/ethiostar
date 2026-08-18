import 'server-only'
import type { DbClaims } from '@db/client'
import { runInTransaction } from '@db/transaction'
import type { Actor } from '@modules/identity'
import { listInboxTasks, type InboxTaskRow } from '../infrastructure/workflow.repository'

export type { InboxTaskRow }

/**
 * "Every user has one inbox showing everything awaiting their action across all modules"
 * (M03 §5) — the unified inbox this powers is generic over `entityType`, which is why the
 * repository query joins only `workflow_instance`/`workflow_definition`, never the owning
 * module's own table.
 */
export async function myInboxTasks(claims: DbClaims, actor: Actor): Promise<InboxTaskRow[]> {
  return runInTransaction(claims, (tx) =>
    listInboxTasks(tx, { roles: actor.roles, userId: actor.userId }),
  )
}

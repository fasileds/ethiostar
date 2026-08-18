import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { listInboxTasks, type InboxTaskRow } from '@modules/workflow'
import { PageHeader, Card, CardHeader, EmptyState } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { Icon } from '@ui/layout/Icon'
import { TasksClient } from './TasksClient'

export const metadata: Metadata = { title: 'Tasks' }

/**
 * M03 — the unified inbox: "every user has one inbox showing everything awaiting their
 * action across all modules". A task shown here can belong to any entity type a workflow
 * definition routes — a delivery request, a contract, whatever M10 and beyond add — because
 * the query never reaches into the owning module's own table.
 */
export default async function TasksPage() {
  const { readiness, actor } = await pageContext()

  const tasks = await pageQuery([] as InboxTaskRow[], (tx) =>
    actor
      ? listInboxTasks(tx, { roles: actor.roles, userId: actor.userId })
      : Promise.resolve([]),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="Approvals waiting on you, from every module that routes through the workflow engine."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Awaiting your decision"
            description="Approve, reject, or return with a comment explaining what needs to change."
          />
        </div>

        {tasks.length === 0 ? (
          <div className="px-4 pb-5 sm:px-5">
            <EmptyState
              title="Nothing waiting on you"
              description="Tasks appear here the moment a workflow step is assigned to your role or to you directly."
              icon={<Icon name="admin" className="size-8" />}
            />
          </div>
        ) : (
          <div className="px-4 pb-5 sm:px-5">
            <TasksClient tasks={tasks} />
          </div>
        )}
      </Card>
    </div>
  )
}

import type { Metadata } from 'next'
import { pageContext, pageQuery } from '@server/page-data'
import { listWorkflowDefinitions, type WorkflowDefinitionRow } from '@modules/workflow'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { WorkflowsClient } from './WorkflowsClient'

export const metadata: Metadata = { title: 'Workflow definitions' }

/**
 * M03 admin — the versioned step lists that route approvals. An edit is always a new
 * `version` row for the same `code`; an in-flight instance keeps the version it started
 * under, so editing a definition never rewrites history that already used it.
 */
export default async function WorkflowsPage() {
  const { readiness } = await pageContext()

  const definitions = await pageQuery([] as WorkflowDefinitionRow[], (tx) =>
    listWorkflowDefinitions(tx),
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflow definitions"
        description="The steps every approval routes through, configured per entity type — a delivery request, a contract, whatever comes next."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Definitions"
            description="Steps are a JSON array of { stepNo, name, approverRole, minThresholdKg?, maxThresholdKg? }. A step with no threshold always applies."
          />
        </div>
        <div className="px-4 pb-5 sm:px-5">
          <WorkflowsClient definitions={definitions} />
        </div>
      </Card>
    </div>
  )
}

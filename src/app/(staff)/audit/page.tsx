import type { Metadata } from 'next'
import {
  pageContext,
  pageQuery,
  listParams,
  firstParam,
  emptyListPage,
} from '@server/page-data'
import { listAuditLog, auditEntityTypes, outboxHealth, type AuditRow } from '@modules/audit'
import { PageHeader, Card, StatCard } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, CursorPager, type Column } from '@ui/patterns/DataTable'
import { FilterTabs, ListToolbar } from '@ui/patterns/FilterBar'
import { When } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'
import { Badge } from '@ui/primitives/Badge'

export const metadata: Metadata = { title: 'Audit' }

const OPERATION_TONE = {
  INSERT: 'complete',
  UPDATE: 'active',
  DELETE: 'danger',
} as const

const COLUMNS: ReadonlyArray<Column<AuditRow>> = [
  {
    key: 'occurredAt',
    header: 'When',
    render: (row) => <When value={row.occurredAt} />,
  },
  {
    key: 'entity',
    header: 'Record',
    render: (row) => (
      <div className="min-w-0">
        <div className="truncate font-medium">{row.entityType}</div>
        <div className="numeric truncate text-2xs text-[var(--text-tertiary)]">
          {row.entityId ?? '—'}
        </div>
      </div>
    ),
  },
  {
    key: 'operation',
    header: 'Operation',
    render: (row) => (
      <Badge
        tone={OPERATION_TONE[row.operation as keyof typeof OPERATION_TONE] ?? 'neutral'}
        size="sm"
      >
        {row.operation}
      </Badge>
    ),
  },
  {
    key: 'actor',
    header: 'Who',
    render: (row) =>
      row.actorName ?? <span className="text-[var(--text-tertiary)]">System</span>,
  },
  {
    key: 'changed',
    header: 'Fields changed',
    render: (row) =>
      row.changedFields.length === 0 ? (
        <span className="text-xs text-[var(--text-tertiary)]">—</span>
      ) : (
        <span className="flex flex-wrap gap-1">
          {row.changedFields.slice(0, 4).map((field) => (
            <span
              key={field}
              className="numeric rounded bg-[var(--surface-sunken)] px-1.5 py-0.5 text-2xs"
            >
              {field}
            </span>
          ))}
          {row.changedFields.length > 4 ? (
            <span className="text-2xs text-[var(--text-tertiary)]">
              +{row.changedFields.length - 4}
            </span>
          ) : null}
        </span>
      ),
  },
  {
    key: 'request',
    header: 'Request',
    secondary: true,
    render: (row) => (
      <span className="numeric text-2xs text-[var(--text-tertiary)]">
        {row.requestId ?? '—'}
      </span>
    ),
  },
]

/**
 * M07 — the audit trail.
 *
 * Append-only and enforced by a database trigger that fires regardless of role, which matters
 * because `service_role` bypasses RLS entirely: a policy alone would not stop a privileged
 * path from rewriting history.
 *
 * The outbox tiles are here rather than in a metrics dashboard because a stalled outbox means
 * events are not reaching their handlers — notifications not sent, projections not updated —
 * and it needs to be visible to whoever is already looking at the record.
 */
export default async function AuditPage(props: PageProps<'/audit'>) {
  const search = await props.searchParams
  const params = listParams(search)
  const { readiness } = await pageContext()

  const entityType = firstParam(search, 'entity')
  const operation = firstParam(search, 'status')

  const [page, types, outbox] = await Promise.all([
    pageQuery(emptyListPage<AuditRow>(), (tx) =>
      listAuditLog(tx, { entityType, operation, cursor: params.cursor }),
    ),
    pageQuery([] as Array<{ type: string; total: number }>, auditEntityTypes),
    pageQuery({ pending: 0, oldestPendingAt: null, deadLettered: 0 }, outboxHealth),
  ])

  const operationTabs = [
    { value: '', label: 'All operations' },
    { value: 'INSERT', label: 'Created' },
    { value: 'UPDATE', label: 'Changed' },
    { value: 'DELETE', label: 'Deleted' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit"
        description="Everything that happened, permanently. Records cannot be edited or deleted by any role, including service_role."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard
          label="Outbox pending"
          intent={outbox.pending > 50 ? 'warn' : 'neutral'}
          value={<span className="numeric text-3xl font-semibold">{outbox.pending}</span>}
          hint="Events awaiting dispatch"
          icon={<Icon name="audit" />}
        />
        <StatCard
          label="Oldest pending"
          value={
            <span className="text-lg font-semibold">
              <When value={outbox.oldestPendingAt} />
            </span>
          }
          hint="A growing gap means the worker is stalled"
          icon={<Icon name="calendar" />}
        />
        <StatCard
          label="Dead-lettered"
          intent={outbox.deadLettered > 0 ? 'warn' : 'neutral'}
          value={<span className="numeric text-3xl font-semibold">{outbox.deadLettered}</span>}
          hint="Exhausted every retry"
          icon={<Icon name="audit" />}
        />
      </div>

      <Card padded={false}>
        <ListToolbar>
          <div className="space-y-2">
            <FilterTabs
              options={operationTabs}
              active={operation ?? ''}
              basePath="/audit"
              params={params}
            />
            {types.length > 0 ? (
              <FilterTabs
                options={[
                  { value: '', label: 'All records' },
                  ...types
                    .slice(0, 8)
                    .map((type) => ({ value: type.type, label: type.type, count: type.total })),
                ]}
                active={entityType ?? ''}
                basePath="/audit"
                paramName="entity"
                params={{ ...params, entity: entityType }}
              />
            ) : null}
          </div>
        </ListToolbar>

        <DataTable
          rows={page.items}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          caption="Audit log"
          empty={{
            title: 'No audit entries',
            description:
              'Entries are written by a database trigger on every insert, update and delete. An empty log means nothing has happened yet.',
            icon: <Icon name="audit" className="size-8" />,
          }}
        />

        <CursorPager
          nextCursor={page.nextCursor}
          hasMore={page.hasMore}
          basePath="/audit"
          params={{ ...params, entity: entityType }}
          shown={page.items.length}
        />
      </Card>
    </div>
  )
}

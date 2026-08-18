import type { Metadata } from 'next'
import { pageContext, pageQuery, firstParam } from '@server/page-data'
import {
  listInvoicesAdmin,
  listCustomersForBilling,
  listBranchesForBilling,
  type InvoiceRow,
} from '@modules/billing'
import { PageHeader, Card, CardHeader } from '@ui/patterns/Card'
import { SetupNotice } from '@ui/patterns/SetupNotice'
import { DataTable, type Column } from '@ui/patterns/DataTable'
import { FilterTabs } from '@ui/patterns/FilterBar'
import { StatusChip } from '@ui/patterns/StatusChip'
import { OnDate } from '@ui/patterns/DateTime'
import { Icon } from '@ui/layout/Icon'
import { GenerateInvoiceForm } from './GenerateInvoiceForm'

export const metadata: Metadata = { title: 'Invoices' }

const COLUMNS: ReadonlyArray<Column<InvoiceRow>> = [
  { key: 'reference', header: 'Invoice', render: (row) => row.reference },
  { key: 'customer', header: 'Customer', render: (row) => row.customerName },
  {
    key: 'issue',
    header: 'Issued',
    secondary: true,
    render: (row) => <OnDate value={row.issueDate} />,
  },
  {
    key: 'due',
    header: 'Due',
    secondary: true,
    render: (row) => <OnDate value={row.dueDate} />,
  },
  {
    key: 'total',
    header: 'Total',
    numeric: true,
    render: (row) => `${row.totalAmount} ${row.currency}`,
  },
  {
    key: 'balance',
    header: 'Balance',
    numeric: true,
    render: (row) =>
      `${(Number(row.totalAmount) - Number(row.paidAmount)).toFixed(2)} ${row.currency}`,
  },
  { key: 'status', header: 'Status', render: (row) => <StatusChip status={row.status} /> },
]

export default async function InvoicesPage(props: PageProps<'/billing/invoices'>) {
  const search = await props.searchParams
  const { readiness } = await pageContext()
  const status = firstParam(search, 'status')

  const [invoices, customers, branches] = await Promise.all([
    pageQuery([] as InvoiceRow[], (tx) => listInvoicesAdmin(tx, status)),
    pageQuery(
      [] as Awaited<ReturnType<typeof listCustomersForBilling>>,
      listCustomersForBilling,
    ),
    pageQuery([] as Awaited<ReturnType<typeof listBranchesForBilling>>, listBranchesForBilling),
  ])

  const tabs = [
    { value: '', label: 'All' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'ISSUED', label: 'Issued' },
    { value: 'PARTIALLY_PAID', label: 'Partially paid' },
    { value: 'PAID', label: 'Paid' },
    { value: 'OVERDUE', label: 'Overdue' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Swept from un-invoiced charges, one line per charge event."
      />

      {!readiness.ready ? <SetupNotice readiness={readiness} /> : null}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Generate an invoice"
            description="Sweeps every un-invoiced charge for the customer within the period."
          />
        </div>
        <div className="px-4 pb-5 sm:px-5">
          <GenerateInvoiceForm customers={customers} branches={branches} />
        </div>
      </Card>

      <Card padded={false}>
        <FilterTabs
          options={tabs}
          active={status ?? ''}
          basePath="/billing/invoices"
          params={{}}
        />
        <DataTable
          rows={invoices}
          columns={COLUMNS}
          rowKey={(row) => row.id}
          rowHref={(row) => `/billing/invoices/${row.id}`}
          caption="Invoices"
          empty={{
            title: 'No invoices',
            description: 'Generate one from a customer’s un-invoiced charges above.',
            icon: <Icon name="documents" className="size-8" />,
          }}
        />
      </Card>
    </div>
  )
}

import 'server-only'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { Locale } from '@config/constants'
import { Letterhead, Footer, DataTable, FieldGrid, styles, type Column } from '../primitives'

/** ACCOUNT_STATEMENT (`STM`) — a customer's invoice and payment history over a period. */

export interface StatementInvoiceProps {
  readonly reference: string
  readonly issueDate: string
  readonly dueDate: string
  readonly status: string
  readonly totalAmount: string
  readonly paidAmount: string
}

export interface StatementPaymentProps {
  readonly reference: string
  readonly receivedAt: Date
  readonly amount: string
  readonly method: string
}

export interface AccountStatementDocumentProps {
  readonly organisationName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly customerName: string
  readonly periodStart: Date
  readonly periodEnd: Date
  readonly currency: string
  readonly openingBalance: string
  readonly closingBalance: string
  readonly invoices: readonly StatementInvoiceProps[]
  readonly payments: readonly StatementPaymentProps[]
}

const INVOICE_COLUMNS: ReadonlyArray<Column<StatementInvoiceProps>> = [
  { header: 'Invoice', width: 100, value: (r) => r.reference },
  { header: 'Issued', width: 80, value: (r) => r.issueDate },
  { header: 'Due', width: 80, value: (r) => r.dueDate },
  { header: 'Status', width: 90, value: (r) => r.status },
  { header: 'Total', width: 80, value: (r) => r.totalAmount, numeric: true },
  { header: 'Paid', width: 70, value: (r) => r.paidAmount, numeric: true },
]

const PAYMENT_COLUMNS: ReadonlyArray<Column<StatementPaymentProps>> = [
  { header: 'Receipt', width: 100, value: (r) => r.reference },
  {
    header: 'Received',
    width: 100,
    value: (r) => r.receivedAt.toISOString().slice(0, 10),
  },
  { header: 'Method', width: 110, value: (r) => r.method },
  { header: 'Amount', width: 90, value: (r) => r.amount, numeric: true },
]

export function AccountStatementDocument(props: AccountStatementDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Account Statement"
          documentNumber={props.documentNumber}
          locale={props.locale}
          qrDataUri={props.qrDataUri}
        />

        <View style={{ marginTop: 10 }}>
          <FieldGrid
            fields={[
              { label: 'Customer', value: props.customerName },
              {
                label: 'Period',
                value: `${props.periodStart.toISOString().slice(0, 10)} to ${props.periodEnd.toISOString().slice(0, 10)}`,
              },
              { label: 'Opening balance', value: `${props.openingBalance} ${props.currency}` },
              { label: 'Closing balance', value: `${props.closingBalance} ${props.currency}` },
            ]}
          />
        </View>

        <Text style={styles.h2}>Invoices</Text>
        <DataTable
          columns={INVOICE_COLUMNS}
          rows={props.invoices}
          locale={props.locale}
          emptyMessage="No invoices in this period."
        />

        <Text style={styles.h2}>Payments</Text>
        <DataTable
          columns={PAYMENT_COLUMNS}
          rows={props.payments}
          locale={props.locale}
          emptyMessage="No payments in this period."
        />

        <Footer
          documentNumber={props.documentNumber}
          printedAt={props.printedAt}
          printedBy={props.printedByName}
          copyNo={props.copyNo}
          locale={props.locale}
        />
      </Page>
    </Document>
  )
}

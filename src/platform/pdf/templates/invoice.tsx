import 'server-only'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { Locale } from '@config/constants'
import {
  Letterhead,
  Footer,
  WatermarkDuplicate,
  DataTable,
  FieldGrid,
  styles,
  palette,
  type Column,
} from '../primitives'

/**
 * TAX_INVOICE (`INV`) and PROFORMA_INVOICE (`PFI`) — the same shape and the same loader
 * (`invoice-print-snapshot.ts`). `isProforma` swaps the title and adds the "not a demand for
 * payment" notice; nothing else differs, which is why both series share this one template.
 */

export interface InvoiceLineProps {
  readonly lineNo: number
  readonly description: string
  readonly serviceCode: string
  readonly quantity: string | null
  readonly uom: string
  readonly rateAmount: string
  readonly lineAmount: string
}

export interface InvoiceDocumentProps {
  readonly organisationName: string
  readonly branchName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string
  readonly isProforma: boolean

  readonly customerName: string
  readonly status: string
  readonly issueDate: string
  readonly dueDate: string
  readonly subtotalAmount: string
  readonly taxAmount: string
  readonly totalAmount: string
  readonly paidAmount: string
  readonly currency: string
  readonly notes: string | null

  readonly lines: readonly InvoiceLineProps[]
}

const LINE_COLUMNS: ReadonlyArray<Column<InvoiceLineProps>> = [
  { header: '#', width: 22, value: (r) => String(r.lineNo) },
  { header: 'Description', width: 210, value: (r) => r.description },
  { header: 'Qty', width: 60, value: (r) => r.quantity ?? '—', numeric: true },
  { header: 'UoM', width: 60, value: (r) => r.uom },
  { header: 'Rate', width: 70, value: (r) => r.rateAmount, numeric: true },
  { header: 'Amount', width: 78, value: (r) => r.lineAmount, numeric: true },
]

export function InvoiceDocument(props: InvoiceDocumentProps) {
  const balanceDue = (Number(props.totalAmount) - Number(props.paidAmount)).toFixed(2)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle={props.isProforma ? 'Proforma Invoice' : 'Tax Invoice'}
          documentNumber={props.documentNumber}
          branchName={props.branchName}
          locale={props.locale}
          qrDataUri={props.qrDataUri}
        />
        <WatermarkDuplicate copyNo={props.copyNo} />

        {props.isProforma ? (
          <View style={{ marginTop: 6 }}>
            <Text style={[styles.small, { color: palette.warning }]}>
              This is a proforma invoice — an estimate, not a demand for payment.
            </Text>
          </View>
        ) : null}

        <View style={{ marginTop: 10 }}>
          <FieldGrid
            fields={[
              { label: 'Customer', value: props.customerName },
              { label: 'Status', value: props.status },
              { label: 'Issue date', value: props.issueDate },
              { label: 'Due date', value: props.dueDate },
            ]}
          />
        </View>

        <Text style={styles.h2}>Lines</Text>
        <DataTable columns={LINE_COLUMNS} rows={props.lines} locale={props.locale} />

        <View style={{ marginTop: 10, alignItems: 'flex-end' }}>
          <View style={{ width: 220 }}>
            <View style={styles.spread}>
              <Text style={styles.small}>Subtotal</Text>
              <Text>
                {props.subtotalAmount} {props.currency}
              </Text>
            </View>
            <View style={styles.spread}>
              <Text style={styles.small}>Tax</Text>
              <Text>
                {props.taxAmount} {props.currency}
              </Text>
            </View>
            <View style={[styles.spread, { marginTop: 3 }]}>
              <Text style={{ fontWeight: 700 }}>Total</Text>
              <Text style={{ fontWeight: 700 }}>
                {props.totalAmount} {props.currency}
              </Text>
            </View>
            <View style={styles.spread}>
              <Text style={styles.small}>Paid</Text>
              <Text>
                {props.paidAmount} {props.currency}
              </Text>
            </View>
            <View style={styles.spread}>
              <Text style={{ fontWeight: 700 }}>Balance due</Text>
              <Text style={{ fontWeight: 700 }}>
                {balanceDue} {props.currency}
              </Text>
            </View>
          </View>
        </View>

        {props.notes ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.small}>Notes</Text>
            <Text>{props.notes}</Text>
          </View>
        ) : null}

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

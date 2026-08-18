import 'server-only'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { Locale } from '@config/constants'
import {
  Letterhead,
  Footer,
  WatermarkDuplicate,
  DataTable,
  FieldGrid,
  SignatureBlock,
  styles,
  type Column,
} from '../primitives'

/**
 * Stock Count Sheet (M06 §7.x, series CNT).
 *
 * A count is per-location, not per-customer, so unlike the GRN and the transfer note there
 * is no single customer field in the header — the DataTable carries a customer column
 * per line instead.
 */

export interface StockCountLineProps {
  readonly lineId: string
  readonly lotReference: string
  readonly customerName: string
  readonly coffeeType: string | null
  readonly coffeeGrade: string | null
  readonly bagType: string | null
  readonly expectedQuantityKg: string
  readonly expectedKeshaCount: number
  readonly countedQuantityKg: string
  readonly countedKeshaCount: number
  readonly varianceKg: string
  readonly varianceKesha: number
  readonly reasonName: string | null
}

export interface StockCountDocumentProps {
  readonly organisationName: string
  readonly branchName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly locationLabel: string
  readonly countedOn: string
  readonly status: string
  readonly countedByName: string | null
  readonly approvedByName: string | null
  readonly approvedAt: Date | null

  readonly lines: readonly StockCountLineProps[]
}

const LINE_COLUMNS: ReadonlyArray<Column<StockCountLineProps>> = [
  { header: 'Lot', width: 82, value: (r) => r.lotReference },
  { header: 'Customer', width: 90, value: (r) => r.customerName },
  { header: 'Coffee type', width: 70, value: (r) => r.coffeeType ?? '—' },
  { header: 'Grade', width: 55, value: (r) => r.coffeeGrade ?? '—' },
  { header: 'Expected kg', width: 60, value: (r) => r.expectedQuantityKg, numeric: true },
  { header: 'Counted kg', width: 60, value: (r) => r.countedQuantityKg, numeric: true },
  { header: 'Var. kg', width: 50, value: (r) => r.varianceKg, numeric: true },
  { header: 'Var. kesha', width: 55, value: (r) => String(r.varianceKesha), numeric: true },
]

export function StockCountDocument(props: StockCountDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Stock Count Sheet"
          documentNumber={props.documentNumber}
          branchName={props.branchName}
          locale={props.locale}
          qrDataUri={props.qrDataUri}
        />
        <WatermarkDuplicate copyNo={props.copyNo} />

        <View style={{ marginTop: 10 }}>
          <FieldGrid
            fields={[
              { label: 'Location', value: props.locationLabel },
              { label: 'Counted on', value: props.countedOn },
              { label: 'Status', value: props.status },
              { label: 'Counted by', value: props.countedByName ?? '—' },
              { label: 'Approved by', value: props.approvedByName ?? '—' },
              {
                label: 'Approved at',
                value: props.approvedAt
                  ? props.approvedAt.toISOString().slice(0, 16).replace('T', ' ')
                  : '—',
              },
            ]}
          />
        </View>

        <Text style={styles.h2}>Lines</Text>
        <DataTable columns={LINE_COLUMNS} rows={props.lines} locale={props.locale} />

        <SignatureBlock
          parties={[
            { role: 'Counted by', name: props.countedByName ?? undefined },
            { role: 'Approved by', name: props.approvedByName ?? undefined },
          ]}
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

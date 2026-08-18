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
 * Goods Receiving Note (GRN) — M11 §7.1.
 *
 * The canonical template. Every other M06 document follows this exact shape: Letterhead,
 * a FieldGrid header block, a DataTable body, a SignatureBlock where custody transfers, and
 * the fixed Footer — nothing in a template file decides layout beyond composing those five.
 */

export interface GoodsReceiptLineProps {
  readonly lineNo: number
  readonly bagType: string | null
  readonly coffeeType: string | null
  readonly coffeeGrade: string | null
  readonly quantityKg: string
  readonly keshaCount: number
}

export interface GoodsReceiptDocumentProps {
  readonly organisationName: string
  readonly branchName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly customerName: string
  readonly vehiclePlate: string | null
  readonly driverName: string | null
  readonly customerRepName: string | null
  readonly locationLabel: string | null
  readonly occurredAt: Date
  readonly receivedByName: string | null
  readonly notes: string | null

  readonly receivedQuantityKg: string
  readonly receivedKeshaCount: number
  readonly varianceKg: string | null
  readonly variancePct: string | null

  readonly lines: readonly GoodsReceiptLineProps[]
}

const LINE_COLUMNS: ReadonlyArray<Column<GoodsReceiptLineProps>> = [
  { header: '#', width: 24, value: (r) => String(r.lineNo) },
  { header: 'Bag type', width: 110, value: (r) => r.bagType ?? '—' },
  { header: 'Coffee type', width: 110, value: (r) => r.coffeeType ?? '—' },
  { header: 'Grade', width: 90, value: (r) => r.coffeeGrade ?? '—' },
  { header: 'Kg', width: 70, value: (r) => r.quantityKg, numeric: true },
  { header: 'Kesha', width: 60, value: (r) => String(r.keshaCount), numeric: true },
]

export function GoodsReceiptDocument(props: GoodsReceiptDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Goods Receiving Note"
          documentNumber={props.documentNumber}
          branchName={props.branchName}
          locale={props.locale}
          qrDataUri={props.qrDataUri}
        />
        <WatermarkDuplicate copyNo={props.copyNo} />

        <View style={{ marginTop: 10 }}>
          <FieldGrid
            fields={[
              { label: 'Customer', value: props.customerName },
              {
                label: 'Received',
                value: props.occurredAt.toISOString().slice(0, 16).replace('T', ' '),
              },
              { label: 'Vehicle plate', value: props.vehiclePlate ?? '—' },
              { label: 'Driver', value: props.driverName ?? '—' },
              { label: 'Customer representative', value: props.customerRepName ?? '—' },
              { label: 'Received by', value: props.receivedByName ?? '—' },
              { label: 'Stored in', value: props.locationLabel ?? '—' },
              {
                label: 'Total received',
                value: `${props.receivedQuantityKg} kg · ${props.receivedKeshaCount} kesha`,
              },
            ]}
          />
        </View>

        <Text style={styles.h2}>Lines</Text>
        <DataTable columns={LINE_COLUMNS} rows={props.lines} locale={props.locale} />

        {props.varianceKg && props.varianceKg !== '0.000' ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.small}>
              Variance against declared quantity: {props.varianceKg} kg
              {props.variancePct ? ` (${props.variancePct}%)` : ''}.
            </Text>
          </View>
        ) : null}

        {props.notes ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.small}>Notes</Text>
            <Text>{props.notes}</Text>
          </View>
        ) : null}

        <SignatureBlock
          parties={[
            { role: 'Store keeper', name: props.receivedByName ?? undefined },
            { role: 'Customer representative', name: props.customerRepName ?? undefined },
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

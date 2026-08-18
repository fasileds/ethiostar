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
 * Delivery Note — M17 §7.2, series DN.
 *
 * The customer-facing record of what left the site, handed to the driver alongside the gate
 * pass.
 */

export interface DispatchNoteLineProps {
  readonly lineNo: number
  readonly lotReference: string
  readonly coffeeType: string | null
  readonly coffeeGrade: string | null
  readonly bagType: string | null
  readonly quantityKg: string
  readonly keshaCount: number
}

export interface DispatchNoteDocumentProps {
  readonly organisationName: string
  readonly branchName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly customerName: string
  readonly status: string
  readonly vehiclePlate: string | null
  readonly trailerPlate: string | null
  readonly driverName: string | null
  readonly transporterName: string | null
  readonly destination: string | null
  readonly loadedQuantityKg: string | null
  readonly loadedKeshaCount: number | null
  readonly plannedQuantityKg: string
  readonly plannedKeshaCount: number | null
  readonly gateOutAt: Date | null
  readonly dispatchedAt: Date | null
  readonly notes: string | null

  readonly lines: readonly DispatchNoteLineProps[]
}

const LINE_COLUMNS: ReadonlyArray<Column<DispatchNoteLineProps>> = [
  { header: '#', width: 24, value: (r) => String(r.lineNo) },
  { header: 'Lot', width: 100, value: (r) => r.lotReference },
  { header: 'Coffee type', width: 100, value: (r) => r.coffeeType ?? '—' },
  { header: 'Grade', width: 80, value: (r) => r.coffeeGrade ?? '—' },
  { header: 'Bag type', width: 90, value: (r) => r.bagType ?? '—' },
  { header: 'Kg', width: 70, value: (r) => r.quantityKg, numeric: true },
  { header: 'Kesha', width: 60, value: (r) => String(r.keshaCount), numeric: true },
]

function fmt(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

export function DispatchNoteDocument(props: DispatchNoteDocumentProps) {
  const quantityLabel =
    props.loadedQuantityKg !== null
      ? `${props.loadedQuantityKg} kg${
          props.loadedKeshaCount !== null ? ` · ${props.loadedKeshaCount} kesha` : ''
        }`
      : `${props.plannedQuantityKg} kg${
          props.plannedKeshaCount !== null ? ` · ${props.plannedKeshaCount} kesha` : ''
        } (planned)`

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Delivery Note"
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
              { label: 'Status', value: props.status },
              { label: 'Vehicle plate', value: props.vehiclePlate ?? '—' },
              { label: 'Trailer plate', value: props.trailerPlate ?? '—' },
              { label: 'Driver', value: props.driverName ?? '—' },
              { label: 'Transporter', value: props.transporterName ?? '—' },
              { label: 'Destination', value: props.destination ?? '—' },
              { label: 'Quantity dispatched', value: quantityLabel },
              { label: 'Gate out', value: fmt(props.gateOutAt) },
              { label: 'Dispatched', value: fmt(props.dispatchedAt) },
            ]}
          />
        </View>

        <Text style={styles.h2}>Lines</Text>
        <DataTable columns={LINE_COLUMNS} rows={props.lines} locale={props.locale} />

        {props.notes ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.small}>Notes</Text>
            <Text>{props.notes}</Text>
          </View>
        ) : null}

        <SignatureBlock
          parties={[
            { role: 'Driver', name: props.driverName ?? undefined },
            { role: 'Gate officer' },
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

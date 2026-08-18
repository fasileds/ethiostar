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
  type Column,
} from '../primitives'

/**
 * Loading List — M17 §7.2, series LL.
 *
 * The picking list handed to the store crew: what to load onto the truck, lot by lot.
 */

export interface LoadingListLineProps {
  readonly lineNo: number
  readonly lotReference: string
  readonly coffeeType: string | null
  readonly coffeeGrade: string | null
  readonly bagType: string | null
  readonly locationCode: string | null
  readonly quantityKg: string
  readonly keshaCount: number
}

export interface LoadingListDocumentProps {
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
  readonly plannedQuantityKg: string
  readonly plannedKeshaCount: number | null
  readonly loadingStartedAt: Date | null
  readonly notes: string | null

  readonly lines: readonly LoadingListLineProps[]
}

const LINE_COLUMNS: ReadonlyArray<Column<LoadingListLineProps>> = [
  { header: '#', width: 22, value: (r) => String(r.lineNo) },
  { header: 'Lot', width: 90, value: (r) => r.lotReference },
  { header: 'Coffee type', width: 86, value: (r) => r.coffeeType ?? '—' },
  { header: 'Grade', width: 70, value: (r) => r.coffeeGrade ?? '—' },
  { header: 'Bag type', width: 80, value: (r) => r.bagType ?? '—' },
  { header: 'From', width: 68, value: (r) => r.locationCode ?? '—' },
  { header: 'Kg', width: 60, value: (r) => r.quantityKg, numeric: true },
  { header: 'Kesha', width: 55, value: (r) => String(r.keshaCount), numeric: true },
]

export function LoadingListDocument(props: LoadingListDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Loading List"
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
              {
                label: 'Planned to load',
                value: `${props.plannedQuantityKg} kg${
                  props.plannedKeshaCount !== null ? ` · ${props.plannedKeshaCount} kesha` : ''
                }`,
              },
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

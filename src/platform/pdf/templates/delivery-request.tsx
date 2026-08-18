import 'server-only'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { Locale } from '@config/constants'
import { Letterhead, Footer, WatermarkDuplicate, FieldGrid, styles } from '../primitives'

/**
 * Delivery Request Acknowledgement — M11 §7.1.
 *
 * Follows the GRN shape: Letterhead, a FieldGrid header block, and the fixed Footer. No
 * DataTable or SignatureBlock — a delivery request is an expectation, not a custody transfer;
 * nothing changes hands until the goods receipt.
 */

export interface DeliveryRequestDocumentProps {
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
  readonly coffeeTypeName: string | null
  readonly coffeeGradeName: string | null
  readonly declaredQuantityKg: string
  readonly declaredKeshaCount: number
  readonly expectedArrivalOn: string
  readonly expectedArrivalWindow: string | null
  readonly transportMode: string | null
  readonly vehiclePlate: string | null
  readonly driverName: string | null
  readonly driverPhone: string | null
  readonly approvedByName: string | null
  readonly approvedAt: Date | null
  readonly rejectionReason: string | null
  readonly notes: string | null
}

export function DeliveryRequestDocument(props: DeliveryRequestDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Delivery Request Acknowledgement"
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
              { label: 'Coffee type', value: props.coffeeTypeName ?? '—' },
              { label: 'Coffee grade', value: props.coffeeGradeName ?? '—' },
              {
                label: 'Declared quantity',
                value: `${props.declaredQuantityKg} kg · ${props.declaredKeshaCount} kesha`,
              },
              { label: 'Expected arrival', value: props.expectedArrivalOn },
              { label: 'Arrival window', value: props.expectedArrivalWindow ?? '—' },
              { label: 'Transport mode', value: props.transportMode ?? '—' },
              { label: 'Vehicle plate', value: props.vehiclePlate ?? '—' },
              { label: 'Driver', value: props.driverName ?? '—' },
              { label: 'Driver phone', value: props.driverPhone ?? '—' },
              {
                label: 'Approved by',
                value: props.approvedByName
                  ? `${props.approvedByName}${props.approvedAt ? ` · ${props.approvedAt.toISOString().slice(0, 10)}` : ''}`
                  : '—',
              },
            ]}
          />
        </View>

        {props.rejectionReason ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.small}>Rejection reason</Text>
            <Text>{props.rejectionReason}</Text>
          </View>
        ) : null}

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

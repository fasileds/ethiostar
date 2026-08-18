import 'server-only'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { Locale } from '@config/constants'
import {
  Letterhead,
  Footer,
  WatermarkDuplicate,
  FieldGrid,
  SignatureBlock,
  styles,
} from '../primitives'

/** RECEIPT (`RCT`) — a payment confirmation. */
export interface ReceiptDocumentProps {
  readonly organisationName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly customerName: string
  readonly invoiceReference: string | null
  readonly amount: string
  readonly currency: string
  readonly method: string
  readonly externalReference: string | null
  readonly receivedAt: Date
  readonly recordedByName: string | null
}

export function ReceiptDocument(props: ReceiptDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Payment Receipt"
          documentNumber={props.documentNumber}
          locale={props.locale}
          qrDataUri={props.qrDataUri}
        />
        <WatermarkDuplicate copyNo={props.copyNo} />

        <View style={{ marginTop: 10 }}>
          <FieldGrid
            fields={[
              { label: 'Received from', value: props.customerName },
              {
                label: 'Received',
                value: props.receivedAt.toISOString().slice(0, 16).replace('T', ' '),
              },
              { label: 'Against invoice', value: props.invoiceReference ?? 'On account' },
              { label: 'Method', value: props.method },
              { label: 'External reference', value: props.externalReference ?? '—' },
              { label: 'Recorded by', value: props.recordedByName ?? '—' },
            ]}
          />
        </View>

        <View style={{ marginTop: 16, alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 16, fontWeight: 700 }}>
            {props.amount} {props.currency}
          </Text>
        </View>

        <SignatureBlock
          parties={[{ role: 'Received by', name: props.recordedByName ?? undefined }]}
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

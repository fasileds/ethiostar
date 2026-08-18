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

/**
 * Store Transfer Note (M06 §7.x, series ST).
 *
 * Follows the GRN shape: Letterhead, a FieldGrid header block, a SignatureBlock where
 * custody moves between locations, and the fixed Footer.
 */

export interface StoreTransferDocumentProps {
  readonly organisationName: string
  readonly branchName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly customerName: string
  readonly lotReference: string
  readonly coffeeType: string | null
  readonly coffeeGrade: string | null
  readonly bagType: string | null
  readonly quantityKg: string
  readonly keshaCount: number
  readonly fromLocationLabel: string
  readonly toLocationLabel: string
  readonly reasonName: string | null
  readonly narrative: string | null
  readonly occurredAt: Date
  readonly authorisedByName: string | null
}

export function StoreTransferDocument(props: StoreTransferDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Store Transfer Note"
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
              { label: 'Lot', value: props.lotReference },
              { label: 'Coffee type', value: props.coffeeType ?? '—' },
              { label: 'Grade', value: props.coffeeGrade ?? '—' },
              { label: 'Bag type', value: props.bagType ?? '—' },
              {
                label: 'Transferred',
                value: `${props.occurredAt.toISOString().slice(0, 16).replace('T', ' ')}`,
              },
              { label: 'From', value: props.fromLocationLabel },
              { label: 'To', value: props.toLocationLabel },
              {
                label: 'Quantity',
                value: `${props.quantityKg} kg · ${props.keshaCount} kesha`,
              },
              { label: 'Reason', value: props.reasonName ?? '—' },
              { label: 'Authorised by', value: props.authorisedByName ?? '—' },
            ]}
          />
        </View>

        {props.narrative ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.small}>Notes</Text>
            <Text>{props.narrative}</Text>
          </View>
        ) : null}

        <SignatureBlock
          parties={[
            { role: 'Store keeper (from)', name: undefined },
            { role: 'Store keeper (to)', name: undefined },
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

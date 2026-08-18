import 'server-only'
import { Document, Page, View } from '@react-pdf/renderer'
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
 * Store Placement Slip — M06 §7.1, M12.
 *
 * Follows the GRN shape: Letterhead, a FieldGrid header block, a SignatureBlock — the store
 * keeper who placed the lot is attesting to where it physically sits — and the fixed Footer.
 */

export interface StorePlacementDocumentProps {
  readonly organisationName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly customerName: string
  readonly consignmentReference: string
  readonly coffeeTypeName: string | null
  readonly coffeeGradeName: string | null
  readonly bagTypeName: string | null
  readonly quantityKg: string
  readonly keshaCount: number
  readonly locationLabel: string
  readonly placedAt: Date
  readonly placedByName: string | null
}

export function StorePlacementDocument(props: StorePlacementDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Store Placement Slip"
          documentNumber={props.documentNumber}
          locale={props.locale}
          qrDataUri={props.qrDataUri}
        />
        <WatermarkDuplicate copyNo={props.copyNo} />

        <View style={{ marginTop: 10 }}>
          <FieldGrid
            fields={[
              { label: 'Lot', value: props.documentNumber },
              { label: 'Consignment', value: props.consignmentReference },
              { label: 'Customer', value: props.customerName },
              { label: 'Coffee type', value: props.coffeeTypeName ?? '—' },
              { label: 'Coffee grade', value: props.coffeeGradeName ?? '—' },
              { label: 'Bag type', value: props.bagTypeName ?? '—' },
              {
                label: 'Quantity',
                value: `${props.quantityKg} kg · ${props.keshaCount} kesha`,
              },
              { label: 'Stored in', value: props.locationLabel },
              {
                label: 'Placed at',
                value: props.placedAt.toISOString().slice(0, 16).replace('T', ' '),
              },
              { label: 'Placed by', value: props.placedByName ?? '—' },
            ]}
          />
        </View>

        <SignatureBlock
          parties={[{ role: 'Store keeper', name: props.placedByName ?? undefined }]}
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

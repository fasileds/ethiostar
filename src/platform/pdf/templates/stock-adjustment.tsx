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
 * Stock Adjustment (M06 §7.x, series ADJ).
 *
 * The highest-risk operational document in the system (schema comment on `stock_adjustment`,
 * threat T2) — the reason code and the approver are given the same prominence as the
 * quantities themselves.
 */

export interface StockAdjustmentDocumentProps {
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
  readonly locationLabel: string
  readonly quantityKgDelta: string
  readonly keshaCountDelta: number
  readonly beforeQuantityKg: string
  readonly beforeKeshaCount: number
  readonly afterQuantityKg: string
  readonly afterKeshaCount: number
  readonly reasonName: string
  readonly narrative: string | null
  readonly occurredAt: Date
  readonly createdByName: string | null
  readonly approvedByName: string | null
  readonly approvedAt: Date | null
}

export function StockAdjustmentDocument(props: StockAdjustmentDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Stock Adjustment"
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
              { label: 'Location', value: props.locationLabel },
              {
                label: 'Adjusted',
                value: props.occurredAt.toISOString().slice(0, 16).replace('T', ' '),
              },
              {
                label: 'Before',
                value: `${props.beforeQuantityKg} kg · ${props.beforeKeshaCount} kesha`,
              },
              {
                label: 'After',
                value: `${props.afterQuantityKg} kg · ${props.afterKeshaCount} kesha`,
              },
              {
                label: 'Delta',
                value: `${props.quantityKgDelta} kg · ${props.keshaCountDelta} kesha`,
              },
              { label: 'Reason', value: props.reasonName },
              { label: 'Recorded by', value: props.createdByName ?? '—' },
              { label: 'Approved by', value: props.approvedByName ?? '—' },
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
            { role: 'Store keeper', name: props.createdByName ?? undefined },
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

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
 * Mirt Merekebiya — Customer Output Acceptance (M16).
 *
 * The most important document in this system: the customer's formal, signed acceptance of
 * what EthioStar processed. Until this is signed, the output is EthioStar's problem; after
 * it, custody and the numbers on this page are what both parties agreed to. The SignatureBlock
 * at the bottom is therefore not decoration — it is the record.
 */

export interface MirtMerekebiyaLineProps {
  readonly lineNo: number
  readonly classificationCode: string | null
  readonly classificationName: string | null
  readonly lotReference: string | null
  readonly quantityKg: string
  readonly keshaCount: number | null
  readonly locationLabel: string | null
  readonly lineVerdict: string
}

export interface MirtMerekebiyaDocumentProps {
  readonly organisationName: string
  readonly branchName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly customerName: string
  readonly consignmentReference: string
  readonly jobOrderReference: string | null
  readonly status: string

  readonly presentedQuantityKg: string
  readonly presentedKeshaCount: number | null
  readonly acceptedQuantityKg: string | null
  readonly acceptedKeshaCount: number | null
  readonly disputedQuantityKg: string | null
  readonly yieldPct: string | null
  readonly lossPct: string | null

  readonly presentedAt: Date | null
  readonly customerRepName: string | null
  readonly customerRepIdNo: string | null
  readonly signedAt: Date | null
  readonly witnessName: string | null
  readonly notes: string | null

  readonly lines: readonly MirtMerekebiyaLineProps[]
}

const OUTPUT_COLUMNS: ReadonlyArray<Column<MirtMerekebiyaLineProps>> = [
  { header: '#', width: 20, value: (r) => String(r.lineNo) },
  {
    header: 'Classification',
    width: 130,
    value: (r) => r.classificationName ?? r.classificationCode ?? '—',
  },
  { header: 'Lot', width: 90, value: (r) => r.lotReference ?? '—' },
  { header: 'Kg', width: 60, value: (r) => r.quantityKg, numeric: true },
  {
    header: 'Kesha',
    width: 50,
    value: (r) => (r.keshaCount === null ? '—' : String(r.keshaCount)),
  },
  { header: 'Location', width: 100, value: (r) => r.locationLabel ?? '—' },
  { header: 'Verdict', width: 74, value: (r) => r.lineVerdict },
]

function formatInstant(value: Date): string {
  return value.toISOString().slice(0, 16).replace('T', ' ')
}

export function MirtMerekebiyaDocument(props: MirtMerekebiyaDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Mirt Merekebiya — Customer Acceptance"
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
              { label: 'Consignment', value: props.consignmentReference },
              { label: 'Job order', value: props.jobOrderReference ?? '—' },
              { label: 'Status', value: props.status },
              {
                label: 'Presented',
                value: props.presentedAt ? formatInstant(props.presentedAt) : '—',
              },
              {
                label: 'Presented quantity',
                value: `${props.presentedQuantityKg} kg${
                  props.presentedKeshaCount !== null
                    ? ` · ${props.presentedKeshaCount} kesha`
                    : ''
                }`,
              },
              {
                label: 'Accepted quantity',
                value:
                  props.acceptedQuantityKg !== null
                    ? `${props.acceptedQuantityKg} kg${
                        props.acceptedKeshaCount !== null
                          ? ` · ${props.acceptedKeshaCount} kesha`
                          : ''
                      }`
                    : '—',
              },
              {
                label: 'Disputed quantity',
                value: props.disputedQuantityKg ? `${props.disputedQuantityKg} kg` : '—',
              },
              { label: 'Yield', value: props.yieldPct ? `${props.yieldPct}%` : '—' },
              { label: 'Process loss', value: props.lossPct ? `${props.lossPct}%` : '—' },
            ]}
          />
        </View>

        <Text style={styles.h2}>Output breakdown</Text>
        <DataTable columns={OUTPUT_COLUMNS} rows={props.lines} locale={props.locale} />

        {props.notes ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.small}>Notes</Text>
            <Text>{props.notes}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 10 }}>
          <FieldGrid
            fields={[
              { label: 'Customer representative', value: props.customerRepName ?? '—' },
              { label: 'Representative ID', value: props.customerRepIdNo ?? '—' },
              { label: 'Witness', value: props.witnessName ?? '—' },
              {
                label: 'Signed',
                value: props.signedAt ? formatInstant(props.signedAt) : 'Not yet signed',
              },
            ]}
          />
        </View>

        <SignatureBlock
          parties={[
            { role: 'EthioStar', name: props.witnessName ?? undefined },
            { role: 'Customer', name: props.customerRepName ?? undefined },
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

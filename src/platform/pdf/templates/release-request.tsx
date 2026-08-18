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
 * Release Request Acknowledgement — M17 §7.2, series RR.
 *
 * Follows the GRN template's shape: Letterhead, a FieldGrid header block, a SignatureBlock,
 * and the fixed Footer.
 */

export interface ReleaseRequestDocumentProps {
  readonly organisationName: string
  readonly branchName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly customerName: string
  readonly consignmentReference: string | null
  readonly status: string
  readonly requestedQuantityKg: string
  readonly requestedKeshaCount: number | null
  readonly requestedCollectionOn: string | null
  readonly authorisedByName: string | null
  readonly collectorName: string | null
  readonly collectorIdNo: string | null
  readonly collectorPhone: string | null
  readonly vehiclePlate: string | null
  readonly submittedAt: Date | null
  readonly approvedByName: string | null
  readonly approvedAt: Date | null
  readonly notes: string | null
}

function fmt(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

export function ReleaseRequestDocument(props: ReleaseRequestDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Release Request Acknowledgement"
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
              { label: 'Consignment', value: props.consignmentReference ?? '—' },
              { label: 'Status', value: props.status },
              {
                label: 'Requested quantity',
                value: `${props.requestedQuantityKg} kg${
                  props.requestedKeshaCount !== null
                    ? ` · ${props.requestedKeshaCount} kesha`
                    : ''
                }`,
              },
              { label: 'Requested collection date', value: props.requestedCollectionOn ?? '—' },
              { label: 'Authorised by', value: props.authorisedByName ?? '—' },
              { label: 'Collector', value: props.collectorName ?? '—' },
              { label: 'Collector ID', value: props.collectorIdNo ?? '—' },
              { label: 'Collector phone', value: props.collectorPhone ?? '—' },
              { label: 'Vehicle plate', value: props.vehiclePlate ?? '—' },
              { label: 'Submitted', value: fmt(props.submittedAt) },
              {
                label: 'Approved',
                value: props.approvedByName
                  ? `${props.approvedByName} · ${fmt(props.approvedAt)}`
                  : '—',
              },
            ]}
          />
        </View>

        {props.notes ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.small}>Notes</Text>
            <Text>{props.notes}</Text>
          </View>
        ) : null}

        <SignatureBlock
          parties={[
            { role: 'Authorised by', name: props.authorisedByName ?? undefined },
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

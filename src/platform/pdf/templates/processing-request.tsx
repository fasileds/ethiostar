import 'server-only'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { Locale } from '@config/constants'
import { Letterhead, Footer, WatermarkDuplicate, FieldGrid, styles } from '../primitives'

/**
 * Processing Request (M06 §7.x, M15) — the customer's request to have stored coffee processed.
 */

export interface ProcessingRequestDocumentProps {
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
  readonly serviceType: string
  readonly requestedQuantityKg: string
  readonly requestedKeshaCount: number | null
  readonly outputSpecification: string | null
  readonly preferredStartOn: string | null
  readonly urgency: string
  readonly submittedAt: Date | null
  readonly approvedByName: string | null
  readonly approvedAt: Date | null
  readonly notes: string | null
}

function formatInstant(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

export function ProcessingRequestDocument(props: ProcessingRequestDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Processing Request"
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
              { label: 'Service type', value: props.serviceType },
              { label: 'Urgency', value: props.urgency },
              { label: 'Preferred start', value: props.preferredStartOn ?? '—' },
              {
                label: 'Requested quantity',
                value: `${props.requestedQuantityKg} kg${
                  props.requestedKeshaCount !== null
                    ? ` · ${props.requestedKeshaCount} kesha`
                    : ''
                }`,
              },
              { label: 'Submitted', value: formatInstant(props.submittedAt) },
              { label: 'Approved by', value: props.approvedByName ?? '—' },
              { label: 'Approved at', value: formatInstant(props.approvedAt) },
            ]}
          />
        </View>

        {props.outputSpecification ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.h2}>Output specification</Text>
            <Text>{props.outputSpecification}</Text>
          </View>
        ) : null}

        {props.notes ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.small}>Special instructions</Text>
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

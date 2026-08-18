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
 * Application Acknowledgement — M06 (onboarding).
 *
 * Issued the moment a prospective customer submits, confirming what was received and the
 * tracking reference to quote for a status lookup. Built from the shared primitives only.
 */

export interface ApplicationAttachedDocumentProps {
  readonly documentTypeName: string
  readonly originalFilename: string | null
}

export interface ApplicationAcknowledgementDocumentProps {
  readonly organisationName: string
  readonly branchName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly reference: string
  readonly legalName: string
  readonly businessTypeName: string | null
  readonly contactName: string
  readonly contactEmail: string
  readonly submittedAt: Date | null

  readonly attachedDocuments: readonly ApplicationAttachedDocumentProps[]
}

const DOCUMENT_COLUMNS: ReadonlyArray<Column<ApplicationAttachedDocumentProps>> = [
  { header: 'Document type', width: 260, value: (r) => r.documentTypeName },
  { header: 'File', width: 220, value: (r) => r.originalFilename ?? 'received offline' },
]

export function ApplicationAcknowledgementDocument(
  props: ApplicationAcknowledgementDocumentProps,
) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Application Acknowledgement"
          documentNumber={props.documentNumber}
          branchName={props.branchName}
          locale={props.locale}
          qrDataUri={props.qrDataUri}
        />
        <WatermarkDuplicate copyNo={props.copyNo} />

        <View style={{ marginTop: 10 }}>
          <FieldGrid
            fields={[
              { label: 'Applicant', value: props.legalName },
              { label: 'Business type', value: props.businessTypeName ?? '—' },
              {
                label: 'Submitted',
                value: props.submittedAt
                  ? props.submittedAt.toISOString().slice(0, 16).replace('T', ' ')
                  : '—',
              },
              { label: 'Tracking reference', value: props.reference },
              { label: 'Contact', value: props.contactName },
              { label: 'Contact email', value: props.contactEmail },
            ]}
          />
        </View>

        <View style={{ marginTop: 8 }}>
          <Text style={styles.small}>
            This acknowledges receipt of the application quoted above. Quote the tracking
            reference to check status at any time. This is not an approval.
          </Text>
        </View>

        <Text style={styles.h2}>Documents attached</Text>
        <DataTable
          columns={DOCUMENT_COLUMNS}
          rows={props.attachedDocuments}
          locale={props.locale}
          emptyMessage="No documents attached at submission."
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

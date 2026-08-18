import 'server-only'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { Locale } from '@config/constants'
import { Letterhead, Footer, WatermarkDuplicate, FieldGrid, styles } from '../primitives'

/**
 * Registration Certificate & Credential Letter — M06 (onboarding).
 *
 * Issued once, on approval, confirming the customer is registered and that a portal login was
 * created for them. The credential itself (password) is never printed — only that an account
 * exists and where the activation email was sent.
 */

export interface RegistrationCertificateDocumentProps {
  readonly organisationName: string
  readonly branchName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly legalName: string
  readonly code: string
  readonly businessTypeName: string | null
  readonly onboardedOn: string | null
  readonly primaryContactEmail: string | null
  readonly credentialsIssued: boolean
}

export function RegistrationCertificateDocument(props: RegistrationCertificateDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Registration Certificate"
          documentNumber={props.documentNumber}
          branchName={props.branchName}
          locale={props.locale}
          qrDataUri={props.qrDataUri}
        />
        <WatermarkDuplicate copyNo={props.copyNo} />

        <View style={{ marginTop: 10 }}>
          <FieldGrid
            fields={[
              { label: 'Registered customer', value: props.legalName },
              { label: 'Customer code', value: props.code },
              { label: 'Business type', value: props.businessTypeName ?? '—' },
              { label: 'Registered branch', value: props.branchName },
              { label: 'Date registered', value: props.onboardedOn ?? '—' },
            ]}
          />
        </View>

        <View style={{ marginTop: 10 }}>
          <Text style={styles.h2}>Custody registration</Text>
          <Text>
            This certifies that {props.legalName} (customer code {props.code}) is registered
            with {props.organisationName} for coffee custody, storage and processing services,
            effective {props.onboardedOn ?? 'the date above'}.
          </Text>
        </View>

        <View style={{ marginTop: 10 }}>
          <Text style={styles.h2}>Portal credentials</Text>
          <Text>
            {props.credentialsIssued
              ? `A portal account was created for this customer. Activation instructions were sent to ${
                  props.primaryContactEmail ?? 'the registered contact email'
                }.`
              : 'No portal account has been created for this customer yet.'}
          </Text>
        </View>

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

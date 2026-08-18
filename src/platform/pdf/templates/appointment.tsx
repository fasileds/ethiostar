import 'server-only'
import { Document, Page, Text, View } from '@react-pdf/renderer'
import type { Locale } from '@config/constants'
import { Letterhead, Footer, WatermarkDuplicate, FieldGrid, styles } from '../primitives'

/**
 * Appointment Confirmation (M14).
 *
 * The scheduled processing slot, handed to the customer once the booking is made. No
 * signature block — this is a confirmation, not a custody-transferring document — but the
 * reschedule note matters: a customer who was pushed back by a cascade should see why.
 */

export interface AppointmentDocumentProps {
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
  readonly machineName: string
  readonly machineCode: string
  readonly scheduledOn: string
  readonly scheduledStartAt: Date
  readonly scheduledEndAt: Date
  readonly plannedQuantityKg: string
  readonly plannedKeshaCount: number | null
  readonly status: string
  readonly rescheduleReason: string | null
  readonly rescheduledFromAt: Date | null
  readonly cumulativeDelayMinutes: number
  readonly notes: string | null
}

function formatInstant(value: Date): string {
  return value.toISOString().slice(0, 16).replace('T', ' ')
}

function formatWindow(start: Date, end: Date): string {
  return `${formatInstant(start)} – ${end.toISOString().slice(11, 16)}`
}

export function AppointmentDocument(props: AppointmentDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Appointment Confirmation"
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
              { label: 'Scheduled date', value: props.scheduledOn },
              {
                label: 'Window',
                value: formatWindow(props.scheduledStartAt, props.scheduledEndAt),
              },
              { label: 'Machine', value: `${props.machineName} (${props.machineCode})` },
              {
                label: 'Quantity to process',
                value: `${props.plannedQuantityKg} kg${
                  props.plannedKeshaCount !== null ? ` · ${props.plannedKeshaCount} kesha` : ''
                }`,
              },
              {
                label: 'Cumulative delay',
                value:
                  props.cumulativeDelayMinutes > 0
                    ? `${props.cumulativeDelayMinutes} min`
                    : 'None',
              },
            ]}
          />
        </View>

        {props.rescheduleReason ? (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.h2}>Reschedule note</Text>
            <Text style={styles.small}>
              {props.rescheduledFromAt
                ? `Previously ${formatInstant(props.rescheduledFromAt)}. `
                : ''}
              {props.rescheduleReason}
            </Text>
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

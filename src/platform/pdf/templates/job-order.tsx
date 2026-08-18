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
 * Job Order (M06 §7.x, M15) — the operator's instruction to run one job on one machine.
 */

export interface JobOrderInputLineProps {
  readonly lineNo: number
  readonly lotReference: string
  readonly coffeeType: string | null
  readonly coffeeGrade: string | null
  readonly quantityKg: string
  readonly keshaCount: number | null
}

export interface JobOrderExpectedOutputProps {
  readonly classificationName: string
  readonly expectedYieldPct: string | null
}

export interface JobOrderDocumentProps {
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
  readonly processingRequestReference: string | null
  readonly status: string
  readonly serviceType: string
  readonly machineName: string | null
  readonly plannedInputKg: string
  readonly plannedKeshaCount: number | null
  readonly scheduledStartAt: Date | null
  readonly supervisorName: string | null
  readonly notes: string | null

  readonly inputs: readonly JobOrderInputLineProps[]
  readonly expectedOutputs: readonly JobOrderExpectedOutputProps[]
}

const INPUT_COLUMNS: ReadonlyArray<Column<JobOrderInputLineProps>> = [
  { header: '#', width: 24, value: (r) => String(r.lineNo) },
  { header: 'Lot', width: 110, value: (r) => r.lotReference },
  { header: 'Coffee type', width: 110, value: (r) => r.coffeeType ?? '—' },
  { header: 'Grade', width: 90, value: (r) => r.coffeeGrade ?? '—' },
  { header: 'Kg', width: 70, value: (r) => r.quantityKg, numeric: true },
  {
    header: 'Kesha',
    width: 60,
    value: (r) => (r.keshaCount === null ? '—' : String(r.keshaCount)),
    numeric: true,
  },
]

const EXPECTED_OUTPUT_COLUMNS: ReadonlyArray<Column<JobOrderExpectedOutputProps>> = [
  { header: 'Classification', width: 260, value: (r) => r.classificationName },
  {
    header: 'Expected yield %',
    width: 120,
    value: (r) => r.expectedYieldPct ?? '—',
    numeric: true,
  },
]

function formatInstant(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

export function JobOrderDocument(props: JobOrderDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Job Order"
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
              { label: 'Processing request', value: props.processingRequestReference ?? '—' },
              { label: 'Status', value: props.status },
              { label: 'Service type', value: props.serviceType },
              { label: 'Machine', value: props.machineName ?? '—' },
              { label: 'Scheduled start', value: formatInstant(props.scheduledStartAt) },
              { label: 'Supervisor', value: props.supervisorName ?? '—' },
              {
                label: 'Planned input',
                value: `${props.plannedInputKg} kg${
                  props.plannedKeshaCount !== null ? ` · ${props.plannedKeshaCount} kesha` : ''
                }`,
              },
            ]}
          />
        </View>

        <Text style={styles.h2}>Input lots</Text>
        <DataTable columns={INPUT_COLUMNS} rows={props.inputs} locale={props.locale} />

        <Text style={styles.h2}>Expected output classifications</Text>
        <DataTable
          columns={EXPECTED_OUTPUT_COLUMNS}
          rows={props.expectedOutputs}
          locale={props.locale}
          emptyMessage="No classifications configured."
        />

        {props.notes ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.small}>Notes</Text>
            <Text>{props.notes}</Text>
          </View>
        ) : null}

        <SignatureBlock
          parties={[
            { role: 'Supervisor', name: props.supervisorName ?? undefined },
            { role: 'Machine operator' },
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

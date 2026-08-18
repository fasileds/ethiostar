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
 * Yield & Reconciliation Statement (M06 §7.x, M15) — the mass-balance reconciliation frozen
 * when a job order closes: input weight against the sum of classified outputs plus loss.
 */

export interface YieldStatementOutputLineProps {
  readonly lineNo: number
  readonly classificationName: string | null
  readonly quantityKg: string
  readonly keshaCount: number | null
  readonly yieldPct: string | null
}

export interface YieldStatementDocumentProps {
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
  readonly serviceType: string
  readonly closedAt: Date | null

  readonly actualInputKg: string
  readonly actualOutputKg: string
  readonly actualLossKg: string
  readonly yieldPct: string | null
  readonly lossPct: string | null
  readonly varianceKg: string | null
  readonly toleranceAppliedPct: string | null
  readonly massBalanceStatus: string | null
  readonly withinTolerance: boolean
  readonly varianceReason: string | null
  readonly varianceApprovedByName: string | null

  readonly outputs: readonly YieldStatementOutputLineProps[]
}

const OUTPUT_COLUMNS: ReadonlyArray<Column<YieldStatementOutputLineProps>> = [
  { header: '#', width: 24, value: (r) => String(r.lineNo) },
  { header: 'Classification', width: 190, value: (r) => r.classificationName ?? '—' },
  { header: 'Kg', width: 90, value: (r) => r.quantityKg, numeric: true },
  {
    header: 'Kesha',
    width: 60,
    value: (r) => (r.keshaCount === null ? '—' : String(r.keshaCount)),
    numeric: true,
  },
  { header: 'Yield %', width: 70, value: (r) => r.yieldPct ?? '—', numeric: true },
]

function formatInstant(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

export function YieldStatementDocument(props: YieldStatementDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Yield & Reconciliation Statement"
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
              { label: 'Service type', value: props.serviceType },
              { label: 'Closed at', value: formatInstant(props.closedAt) },
              { label: 'Input weight', value: `${props.actualInputKg} kg` },
              { label: 'Output weight', value: `${props.actualOutputKg} kg` },
              {
                label: 'Process loss',
                value: `${props.actualLossKg} kg${props.lossPct ? ` (${props.lossPct}%)` : ''}`,
              },
              { label: 'Overall yield', value: props.yieldPct ? `${props.yieldPct}%` : '—' },
              { label: 'Variance', value: props.varianceKg ? `${props.varianceKg} kg` : '—' },
              {
                label: 'Tolerance applied',
                value: props.toleranceAppliedPct ? `${props.toleranceAppliedPct}%` : '—',
              },
              {
                label: 'Mass balance status',
                value: `${props.massBalanceStatus ?? '—'} · ${props.withinTolerance ? 'Within tolerance' : 'Exception'}`,
              },
              { label: 'Variance approved by', value: props.varianceApprovedByName ?? '—' },
            ]}
          />
        </View>

        <Text style={styles.h2}>Output classifications</Text>
        <DataTable columns={OUTPUT_COLUMNS} rows={props.outputs} locale={props.locale} />

        {!props.withinTolerance && props.varianceReason ? (
          <View style={{ marginTop: 8 }}>
            <Text style={styles.small}>Variance explanation</Text>
            <Text>{props.varianceReason}</Text>
          </View>
        ) : null}

        <SignatureBlock parties={[{ role: 'Supervisor' }, { role: 'Quality controller' }]} />

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

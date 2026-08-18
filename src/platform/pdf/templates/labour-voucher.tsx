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
 * Labour Payment Voucher — M06 §7.1, M18.
 *
 * Follows the GRN shape: Letterhead, a FieldGrid header block, a DataTable of the per-worker
 * split, a SignatureBlock, and the fixed Footer. The header's confirmed kesha count and rate
 * are what the whole voucher is answerable to — the table below must foot to it.
 */

export interface LabourVoucherWorkerProps {
  readonly workerCode: string
  readonly workerName: string
  readonly keshaCount: number | null
  readonly quantityKg: string | null
  readonly amount: string
}

export interface LabourVoucherDocumentProps {
  readonly organisationName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly crewName: string | null
  readonly jobOrderReference: string | null
  readonly consignmentReference: string | null
  readonly activityTypeName: string
  readonly producedOn: string
  readonly rateBasis: string | null
  readonly rateAmount: string | null
  readonly currency: string
  readonly confirmedKeshaCount: number | null
  readonly totalQuantityKg: string | null
  readonly totalAmount: string

  readonly workers: readonly LabourVoucherWorkerProps[]
}

const WORKER_COLUMNS: ReadonlyArray<Column<LabourVoucherWorkerProps>> = [
  { header: 'Code', width: 60, value: (r) => r.workerCode },
  { header: 'Worker', width: 170, value: (r) => r.workerName },
  {
    header: 'Kesha',
    width: 60,
    value: (r) => (r.keshaCount === null ? '—' : String(r.keshaCount)),
    numeric: true,
  },
  { header: 'Kg', width: 60, value: (r) => r.quantityKg ?? '—', numeric: true },
  { header: 'Amount', width: 90, value: (r) => r.amount, numeric: true },
]

export function LabourVoucherDocument(props: LabourVoucherDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Labour Payment Voucher"
          documentNumber={props.documentNumber}
          locale={props.locale}
          qrDataUri={props.qrDataUri}
        />
        <WatermarkDuplicate copyNo={props.copyNo} />

        <View style={{ marginTop: 10 }}>
          <FieldGrid
            fields={[
              { label: 'Crew', value: props.crewName ?? '—' },
              { label: 'Job order', value: props.jobOrderReference ?? '—' },
              { label: 'Consignment', value: props.consignmentReference ?? '—' },
              { label: 'Activity', value: props.activityTypeName },
              { label: 'Date', value: props.producedOn },
              {
                label: 'Rate applied',
                value: props.rateAmount
                  ? `${props.rateAmount} ${props.currency} ${props.rateBasis ?? ''}`.trim()
                  : '—',
              },
              {
                label: 'Confirmed count',
                value: `${props.confirmedKeshaCount ?? '—'} kesha${
                  props.totalQuantityKg ? ` · ${props.totalQuantityKg} kg` : ''
                }`,
              },
              { label: 'Total paid', value: `${props.totalAmount} ${props.currency}` },
            ]}
          />
        </View>

        <Text style={styles.h2}>Worker split</Text>
        <DataTable columns={WORKER_COLUMNS} rows={props.workers} locale={props.locale} />

        <SignatureBlock parties={[{ role: 'Supervisor' }, { role: 'Paid by' }]} />

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

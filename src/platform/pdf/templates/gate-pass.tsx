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
  palette,
} from '../primitives'

/**
 * Gate Pass — M17 §7.2, series GP.
 *
 * What the security officer checks against the truck at the gate. Plate, driver and
 * destination are pulled into a large-print block above the usual FieldGrid — the officer
 * reads this standing at the truck, not at a desk.
 */

export interface GatePassDocumentProps {
  readonly organisationName: string
  readonly branchName: string
  readonly documentNumber: string
  readonly qrDataUri: string
  readonly locale: Locale
  readonly copyNo: number
  readonly printedAt: Date
  readonly printedByName: string

  readonly customerName: string
  readonly status: string
  readonly vehiclePlate: string | null
  readonly trailerPlate: string | null
  readonly driverName: string | null
  readonly driverIdNo: string | null
  readonly driverPhone: string | null
  readonly transporterName: string | null
  readonly destination: string | null
  readonly loadedQuantityKg: string | null
  readonly loadedKeshaCount: number | null
  readonly clearanceStatus: string | null
  readonly clearanceNote: string | null
  readonly clearanceCheckedAt: Date | null
  readonly clearanceCheckedByName: string | null
  readonly gateOutAt: Date | null
}

function fmt(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—'
}

export function GatePassDocument(props: GatePassDocumentProps) {
  const isCleared = props.clearanceStatus === 'CLEARED'

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Letterhead
          organisationName={props.organisationName}
          documentTitle="Gate Pass"
          documentNumber={props.documentNumber}
          branchName={props.branchName}
          locale={props.locale}
          qrDataUri={props.qrDataUri}
        />
        <WatermarkDuplicate copyNo={props.copyNo} />

        <View
          style={{
            marginTop: 10,
            borderWidth: 1,
            borderColor: palette.rule,
            backgroundColor: palette.band,
            padding: 10,
          }}
        >
          <View style={styles.spread}>
            <View>
              <Text style={styles.small}>Vehicle plate</Text>
              <Text style={{ fontSize: 20, fontWeight: 700 }}>{props.vehiclePlate ?? '—'}</Text>
            </View>
            <View>
              <Text style={styles.small}>Driver</Text>
              <Text style={{ fontSize: 16, fontWeight: 700 }}>{props.driverName ?? '—'}</Text>
              <Text style={styles.small}>ID: {props.driverIdNo ?? '—'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.small}>Destination</Text>
              <Text style={{ fontSize: 16, fontWeight: 700 }}>{props.destination ?? '—'}</Text>
            </View>
          </View>

          <View style={{ marginTop: 8 }}>
            <Text
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: isCleared ? palette.ink : palette.warning,
              }}
            >
              Clearance: {props.clearanceStatus ?? 'NOT CHECKED'}
            </Text>
            {props.clearanceNote ? (
              <Text style={styles.small}>{props.clearanceNote}</Text>
            ) : null}
          </View>
        </View>

        <View style={{ marginTop: 10 }}>
          <FieldGrid
            fields={[
              { label: 'Customer', value: props.customerName },
              { label: 'Status', value: props.status },
              { label: 'Trailer plate', value: props.trailerPlate ?? '—' },
              { label: 'Driver phone', value: props.driverPhone ?? '—' },
              { label: 'Transporter', value: props.transporterName ?? '—' },
              {
                label: 'Quantity loaded',
                value:
                  props.loadedQuantityKg !== null
                    ? `${props.loadedQuantityKg} kg${
                        props.loadedKeshaCount !== null
                          ? ` · ${props.loadedKeshaCount} kesha`
                          : ''
                      }`
                    : '—',
              },
              {
                label: 'Clearance checked',
                value: props.clearanceCheckedByName
                  ? `${props.clearanceCheckedByName} · ${fmt(props.clearanceCheckedAt)}`
                  : '—',
              },
              { label: 'Gate out', value: fmt(props.gateOutAt) },
            ]}
          />
        </View>

        <SignatureBlock
          parties={[
            { role: 'Driver', name: props.driverName ?? undefined },
            { role: 'Security officer', name: props.clearanceCheckedByName ?? undefined },
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

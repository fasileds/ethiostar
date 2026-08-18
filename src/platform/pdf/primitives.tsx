import 'server-only'
import { Text, View, Image, StyleSheet } from '@react-pdf/renderer'
import type { Locale } from '@config/constants'
import { familyFor } from './fonts'

/**
 * Shared document primitives.
 *
 * Every M06 document is built from these rather than from raw `<View>`s, so the mandatory
 * parts — the letterhead, and above all the footer carrying number, timestamp and printed-by
 * — cannot be forgotten by whoever writes the next template. That is the M06 key control
 * made structural instead of documented.
 *
 * react-pdf implements a SUBSET of CSS: no grid, no float, limited selectors. Layout here is
 * flexbox and fixed widths only.
 */

export const palette = {
  ink: '#1a1a1a',
  muted: '#595959',
  rule: '#c8c8c8',
  band: '#f2f2f2',
  warning: '#8a1f11',
} as const

export const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 64,
    paddingHorizontal: 40,
    fontSize: 9,
    color: palette.ink,
  },
  h1: { fontSize: 15, fontWeight: 700, marginBottom: 2 },
  h2: { fontSize: 11, fontWeight: 700, marginTop: 12, marginBottom: 4 },
  small: { fontSize: 7.5, color: palette.muted },
  row: { flexDirection: 'row' },
  spread: { flexDirection: 'row', justifyContent: 'space-between' },
  rule: { borderBottomWidth: 1, borderBottomColor: palette.rule, marginVertical: 6 },
  cell: { paddingVertical: 3, paddingHorizontal: 4 },
  headCell: { paddingVertical: 3, paddingHorizontal: 4, fontWeight: 700 },
  numeric: { textAlign: 'right' },
})

// ── Letterhead ───────────────────────────────────────────────────────────────

export interface LetterheadProps {
  readonly organisationName: string
  readonly documentTitle: string
  readonly documentNumber: string
  readonly branchName?: string | undefined
  readonly locale: Locale
  /** PNG data URI from `platform/barcode`. */
  readonly qrDataUri?: string | undefined
}

/**
 * The head of every document.
 *
 * ⚠️ `organisationName` is passed in rather than hardcoded. Decision #1 in
 * docs/phase-1/STATUS.md — the legal and brand spelling of "EthioStar" is still owed by the
 * client, and it appears on every printed page. One caller-supplied value means confirming
 * it is a configuration change, not a search-and-replace across nineteen templates.
 */
export function Letterhead(props: LetterheadProps) {
  return (
    <View>
      <View style={styles.spread}>
        <View style={{ flexGrow: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>
            {props.organisationName.toUpperCase()}
          </Text>
          <Text style={styles.small}>Coffee Sorting &amp; Processing Services</Text>
          {props.branchName ? <Text style={styles.small}>{props.branchName}</Text> : null}
        </View>

        <View style={{ alignItems: 'flex-end', width: 190 }}>
          <Text style={styles.h1}>{props.documentTitle}</Text>
          <Text style={{ fontSize: 10, fontWeight: 700 }}>{props.documentNumber}</Text>
        </View>

        {props.qrDataUri ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's Image takes no alt
          <Image src={props.qrDataUri} style={{ width: 54, height: 54, marginLeft: 10 }} />
        ) : null}
      </View>
      <View style={styles.rule} />
    </View>
  )
}

// ── Footer ───────────────────────────────────────────────────────────────────

export interface FooterProps {
  readonly documentNumber: string
  readonly printedAt: Date
  readonly printedBy: string
  readonly copyNo: number
  readonly locale: Locale
}

/**
 * The M06 key control, on every page.
 *
 * `fixed` repeats it on every page of a multi-page document — a loading list that runs to
 * three pages must not have two unattributed ones. `render` gives the page numbering, so a
 * missing page is visible.
 */
export function Footer(props: FooterProps) {
  return (
    <View
      fixed
      style={{
        position: 'absolute',
        bottom: 28,
        left: 40,
        right: 40,
        borderTopWidth: 1,
        borderTopColor: palette.rule,
        paddingTop: 4,
      }}
    >
      <View style={styles.spread}>
        <Text style={styles.small}>
          {props.documentNumber} · printed{' '}
          {props.printedAt.toISOString().replace('T', ' ').slice(0, 16)} UTC
          {' · by '}
          {props.printedBy}
          {props.copyNo > 1 ? ` · COPY ${props.copyNo}` : ''}
        </Text>
        <Text
          style={styles.small}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </View>
    </View>
  )
}

// ── Duplicate watermark ──────────────────────────────────────────────────────

/**
 * Diagonal DUPLICATE band for any copy after the first.
 *
 * A reprint that looks identical to the original is how two "originals" of a gate pass end
 * up in circulation.
 */
export function WatermarkDuplicate({ copyNo }: { readonly copyNo: number }) {
  if (copyNo <= 1) return null

  return (
    <View
      fixed
      style={{
        position: 'absolute',
        top: 300,
        left: 60,
        right: 60,
        alignItems: 'center',
        opacity: 0.12,
      }}
    >
      <Text
        style={{
          fontSize: 62,
          fontWeight: 700,
          color: palette.warning,
          transform: 'rotate(-30deg)',
        }}
      >
        DUPLICATE
      </Text>
    </View>
  )
}

// ── Data table ───────────────────────────────────────────────────────────────

export interface Column<T> {
  readonly header: string
  readonly width: number
  readonly value: (row: T) => string
  readonly numeric?: boolean
}

/**
 * A bordered table with a repeating header.
 *
 * `fixed` on the header row is what keeps a loading list readable when it spills onto a
 * second page — the store keeper reading it at the truck has no way to flip back.
 */
export function DataTable<T>({
  columns,
  rows,
  locale,
  emptyMessage = 'No lines.',
}: {
  readonly columns: ReadonlyArray<Column<T>>
  readonly rows: readonly T[]
  readonly locale: Locale
  readonly emptyMessage?: string
}) {
  const family = familyFor(locale)

  return (
    <View style={{ borderWidth: 1, borderColor: palette.rule, fontFamily: family }}>
      <View fixed style={{ flexDirection: 'row', backgroundColor: palette.band }}>
        {columns.map((column) => (
          <Text
            key={column.header}
            style={[
              styles.headCell,
              { width: column.width },
              column.numeric ? styles.numeric : {},
            ]}
          >
            {column.header}
          </Text>
        ))}
      </View>

      {rows.length === 0 ? (
        <Text style={[styles.cell, { color: palette.muted }]}>{emptyMessage}</Text>
      ) : (
        rows.map((row, index) => (
          <View
            key={index}
            wrap={false}
            style={{
              flexDirection: 'row',
              borderTopWidth: 1,
              borderTopColor: palette.rule,
            }}
          >
            {columns.map((column) => (
              <Text
                key={column.header}
                style={[
                  styles.cell,
                  { width: column.width },
                  column.numeric ? styles.numeric : {},
                ]}
              >
                {column.value(row)}
              </Text>
            ))}
          </View>
        ))
      )}
    </View>
  )
}

// ── Field list and signatures ────────────────────────────────────────────────

/** Label/value pairs, two per line. Used for the header block of most documents. */
export function FieldGrid({
  fields,
}: {
  readonly fields: ReadonlyArray<{ label: string; value: string }>
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {fields.map((field) => (
        <View key={field.label} style={{ width: '50%', paddingVertical: 2 }}>
          <Text style={styles.small}>{field.label}</Text>
          <Text>{field.value}</Text>
        </View>
      ))}
    </View>
  )
}

/**
 * Signature blocks for both parties.
 *
 * Present on every custody-transferring document. The Mirt Merekebiya requires them by
 * definition; the GRN and gate pass need them because the signature is what makes the count
 * on the page a count both parties agreed rather than one EthioStar asserted.
 */
export function SignatureBlock({
  parties,
}: {
  readonly parties: ReadonlyArray<{ role: string; name?: string | undefined }>
}) {
  return (
    <View style={{ flexDirection: 'row', marginTop: 26 }} wrap={false}>
      {parties.map((party) => (
        <View key={party.role} style={{ flexGrow: 1, marginRight: 18 }}>
          <View style={{ borderBottomWidth: 1, borderBottomColor: palette.ink, height: 26 }} />
          <Text style={[styles.small, { marginTop: 3 }]}>{party.role}</Text>
          {party.name ? <Text style={styles.small}>{party.name}</Text> : null}
          <Text style={[styles.small, { marginTop: 8 }]}>Name / Signature / Date</Text>
        </View>
      ))}
    </View>
  )
}

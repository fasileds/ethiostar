/**
 * Generic CSV writer, shared by every standard report's export.
 *
 * RFC 4180 quoting: a field is quoted when it contains a comma, a quote or a newline, and an
 * embedded quote is doubled. Everything else is written bare — quoting every field would
 * still be correct but makes a plain numeric column harder to eyeball when opened as text.
 */

export interface CsvColumn<T> {
  readonly key: keyof T
  readonly header: string
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function quoteCell(raw: string): string {
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`
  }
  return raw
}

export function rowsToCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map((c) => quoteCell(c.header)).join(',')
  const lines = rows.map((row) =>
    columns.map((c) => quoteCell(formatCell(row[c.key]))).join(','),
  )
  return [header, ...lines].join('\r\n') + '\r\n'
}

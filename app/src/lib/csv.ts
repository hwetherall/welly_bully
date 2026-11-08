// Hand-rolled CSV parser + roster-import helpers for Sprint 3 (plan P0.7).
// UI-free on purpose so vitest can cover it — see src/lib/__tests__/csv.test.ts.
//
// The parser handles RFC-4180-style quoting: quoted fields may contain commas,
// newlines and escaped double quotes (""), and line endings may be CRLF, LF or CR.
// It is deliberately forgiving: an unterminated quote consumes to end of input
// instead of throwing, so one malformed row cannot sink a whole import file.

/** One parsed CSV record: the raw cell values, in column order. */
export type CsvRecord = string[]

/**
 * Parse CSV text into records. Blank lines (no cells, or a single empty cell)
 * are skipped. Trailing newline at EOF does not produce a phantom record.
 */
export function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  let fieldStarted = false // at least one char consumed for the current field

  const endField = () => {
    record.push(field)
    field = ''
    fieldStarted = false
  }
  const endRecord = () => {
    endField()
    if (record.length > 1 || record[0] !== '') records.push(record)
    record = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"' && !fieldStarted) {
      inQuotes = true
      fieldStarted = true
      continue
    }
    if (ch === ',') {
      endField()
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++ // CRLF counts as one break
      endRecord()
      continue
    }
    field += ch
    fieldStarted = true
  }
  // EOF: flush any pending field/record (file without trailing newline)
  if (fieldStarted || record.length > 0) endRecord()

  return records
}

//------------------------------------------------------------------------
// Roster import header handling
//------------------------------------------------------------------------

/** Columns the roster import understands (sent to create_roster_import as JSON keys). */
export const ROSTER_COLUMNS = ['first_name', 'last_name', 'email', 'phone', 'pathway', 'membership_status'] as const

export type RosterColumn = (typeof ROSTER_COLUMNS)[number]

/** Headers that must be present for an import to make sense (the RPC validates values). */
export const REQUIRED_ROSTER_COLUMNS: RosterColumn[] = ['first_name', 'email']

/** Normalize a header cell: trim, lowercase, collapse inner whitespace/underscores. */
export function normalizeHeader(cell: string): string {
  return cell.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export interface ParsedRosterFile {
  /** normalized header → column index */
  columns: Partial<Record<RosterColumn, number>>
  /** data rows as objects keyed by normalized column name (unknown columns dropped) */
  rows: Record<string, string>[]
  /** human-readable problems; `line` is 1-based including the header row */
  errors: { line: number; message: string }[]
}

/**
 * Parse roster CSV text into row objects ready for rpc create_roster_import(p_rows).
 * Forgiving about column order and case ("First Name" works); strict about the
 * required headers. Data rows with more cells than the header are reported as
 * errors and skipped; short rows are padded with ''.
 */
export function parseRosterCsv(text: string): ParsedRosterFile {
  const errors: ParsedRosterFile['errors'] = []
  if (text.trim() === '') {
    return { columns: {}, rows: [], errors: [{ line: 1, message: 'File is empty — expected a header row.' }] }
  }
  const records = parseCsv(text)
  if (records.length === 0) {
    return { columns: {}, rows: [], errors: [{ line: 1, message: 'File is empty — expected a header row.' }] }
  }

  const headerCells = records[0].map(normalizeHeader)
  const columns: ParsedRosterFile['columns'] = {}
  for (const col of ROSTER_COLUMNS) {
    const idx = headerCells.indexOf(col)
    if (idx !== -1) columns[col] = idx
  }
  for (const req of REQUIRED_ROSTER_COLUMNS) {
    if (columns[req] === undefined) {
      errors.push({ line: 1, message: `Missing required column "${req}" in the header row.` })
    }
  }
  if (errors.length > 0) return { columns, rows: [], errors }

  const rows: Record<string, string>[] = []
  for (let r = 1; r < records.length; r++) {
    const cells = records[r]
    const line = r + 1
    if (cells.length > headerCells.length) {
      errors.push({ line, message: `Row has ${cells.length} cells but the header has ${headerCells.length} — skipped.` })
      continue
    }
    const row: Record<string, string> = {}
    for (const col of ROSTER_COLUMNS) {
      const idx = columns[col]
      row[col] = idx !== undefined ? (cells[idx] ?? '').trim() : ''
    }
    rows.push(row)
  }
  return { columns, rows, errors }
}

/** Sample roster template for the "Download sample CSV" button (synthetic data only, D7). */
export const SAMPLE_CSV = [
  ROSTER_COLUMNS.join(','),
  'Alex,Rivera,alex.rivera@example.com,303-555-0101,mens,active',
  'Sam,"Chen, Jr.",sam.chen@example.com,303-555-0102,womens,pending',
  '"Jordan ""JB"" Okafor",,jordan.okafor@example.com,,mixed,active',
].join('\r\n') + '\r\n'

/** Browser download helper for the sample template (blob → object URL → anchor click). */
export function downloadSampleCsv(filename = 'roster-import-sample.csv'): void {
  const blob = new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

import { describe, expect, it } from 'vitest'
import { ROSTER_COLUMNS, SAMPLE_CSV, normalizeHeader, parseCsv, parseRosterCsv } from '../csv'

describe('parseCsv', () => {
  it('parses a simple LF file', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('handles CRLF and lone CR line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r3,4\r')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('handles quoted fields containing commas', () => {
    expect(parseCsv('name,note\n"Chen, Jr.",ok\n')).toEqual([
      ['name', 'note'],
      ['Chen, Jr.', 'ok'],
    ])
  })

  it('handles escaped double quotes inside quoted fields', () => {
    expect(parseCsv('"Jordan ""JB"" Okafor",x\n')).toEqual([['Jordan "JB" Okafor', 'x']])
  })

  it('handles newlines inside quoted fields', () => {
    expect(parseCsv('a,b\n"line1\nline2",2\n')).toEqual([
      ['a', 'b'],
      ['line1\nline2', '2'],
    ])
  })

  it('does not emit a phantom record for a trailing newline', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']])
  })

  it('accepts a file without trailing newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('skips blank lines', () => {
    expect(parseCsv('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('tolerates an unterminated quote by consuming to EOF', () => {
    expect(parseCsv('a,b\n"open,2')).toEqual([
      ['a', 'b'],
      ['open,2'],
    ])
  })

  it('parses empty input to no records', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('\n')).toEqual([])
  })
})

describe('normalizeHeader', () => {
  it('lowercases, trims and maps spaces/dashes to underscores', () => {
    expect(normalizeHeader(' First Name ')).toBe('first_name')
    expect(normalizeHeader('EMAIL')).toBe('email')
    expect(normalizeHeader('membership-status')).toBe('membership_status')
  })
})

describe('parseRosterCsv', () => {
  it('maps columns by header regardless of order or case', () => {
    const out = parseRosterCsv('Email,First_Name,Last Name,Phone,Pathway,Membership Status\nA@B.co,Jane,Doe,123,mens,active\n')
    expect(out.errors).toEqual([])
    expect(out.rows).toEqual([
      { first_name: 'Jane', last_name: 'Doe', email: 'A@B.co', phone: '123', pathway: 'mens', membership_status: 'active' },
    ])
    expect(out.columns.email).toBe(0)
  })

  it('errors when a required header is missing', () => {
    const out = parseRosterCsv('first_name,phone\nJane,123\n')
    expect(out.rows).toEqual([])
    expect(out.errors).toHaveLength(1)
    expect(out.errors[0].line).toBe(1)
    expect(out.errors[0].message).toContain('email')
  })

  it('errors on an empty file', () => {
    const out = parseRosterCsv('   \n')
    expect(out.errors[0].message).toContain('empty')
  })

  it('skips data rows with more cells than the header and reports the line', () => {
    const out = parseRosterCsv('first_name,email\nJane,a@b.co\nBad,b@b.co,extra,cells\nOk,c@b.co\n')
    expect(out.rows.map((r) => r.first_name)).toEqual(['Jane', 'Ok'])
    expect(out.errors).toEqual([{ line: 3, message: expect.stringContaining('4 cells') }])
  })

  it('pads short rows with empty strings', () => {
    const out = parseRosterCsv('first_name,last_name,email\nJane\n')
    expect(out.rows).toEqual([{ first_name: 'Jane', last_name: '', email: '', phone: '', pathway: '', membership_status: '' }])
  })

  it('trims cell values', () => {
    const out = parseRosterCsv('first_name,email\n  Jane  ,  a@b.co  \n')
    expect(out.rows[0]).toMatchObject({ first_name: 'Jane', email: 'a@b.co' })
  })

  it('reports header-only files as having no rows (empty rows array, no errors)', () => {
    const out = parseRosterCsv('first_name,email\n')
    expect(out.errors).toEqual([])
    expect(out.rows).toEqual([])
  })

  it('round-trips the sample template through the parser', () => {
    const out = parseRosterCsv(SAMPLE_CSV)
    expect(out.errors).toEqual([])
    expect(out.rows).toHaveLength(3)
    expect(out.rows[0].email).toBe('alex.rivera@example.com')
    expect(out.rows[1].last_name).toBe('Chen, Jr.')
    expect(out.rows[2].first_name).toBe('Jordan "JB" Okafor')
    expect(Object.keys(out.rows[0]).sort()).toEqual([...ROSTER_COLUMNS].sort())
  })
})

import { describe, expect, it } from 'vitest'
import {
  candidateName,
  confirmChips,
  importStatusChip,
  latestSeason,
  matchChip,
  resolveCurrentSeason,
  summaryChips,
  type SeasonRow,
} from '../roster'

describe('matchChip (preview row badges)', () => {
  it('new is green', () => {
    const c = matchChip('new')
    expect(c.label).toBe('new')
    expect(c.className).toContain('bg-green-100')
  })
  it('existing is blue', () => {
    const c = matchChip('existing')
    expect(c.label).toBe('existing')
    expect(c.className).toContain('bg-blue-100')
  })
  it('duplicate_in_file is amber', () => {
    const c = matchChip('duplicate_in_file')
    expect(c.label).toBe('duplicate in file')
    expect(c.className).toContain('bg-amber-100')
  })
  it('invalid is red and includes the reason', () => {
    const c = matchChip('invalid', 'valid email required')
    expect(c.label).toBe('invalid — valid email required')
    expect(c.className).toContain('bg-red-100')
  })
  it('invalid without reason has a plain label', () => {
    expect(matchChip('invalid').label).toBe('invalid')
  })
  it('unknown values fall back to gray', () => {
    const c = matchChip('weird')
    expect(c.label).toBe('weird')
    expect(c.className).toContain('bg-gray-100')
  })
})

describe('importStatusChip', () => {
  it('preview is amber, confirmed is green', () => {
    expect(importStatusChip('preview').className).toContain('bg-amber-100')
    expect(importStatusChip('confirmed').className).toContain('bg-green-100')
    expect(importStatusChip('other').label).toBe('other')
  })
})

describe('summaryChips', () => {
  it('returns ordered label/value chips and ignores non-numeric junk', () => {
    const chips = summaryChips({ total: 5, valid: 3, new: 1, existing: 2, duplicate_in_file: 1, invalid: 1, season_year: 2026 })
    expect(chips.map((c) => [c.key, c.value])).toEqual([
      ['total', 5],
      ['valid', 3],
      ['new', 1],
      ['existing', 2],
      ['duplicate_in_file', 1],
      ['invalid', 1],
    ])
  })
  it('handles null/undefined', () => {
    expect(summaryChips(null)).toEqual([])
    expect(summaryChips(undefined)).toEqual([])
  })
})

describe('confirmChips', () => {
  it('extracts the confirm counts', () => {
    const chips = confirmChips({ people_created: 2, people_matched: 3, participations_created: 5, confirmed_at: 'now' })
    expect(chips.map((c) => [c.key, c.value])).toEqual([
      ['people_created', 2],
      ['people_matched', 3],
      ['participations_created', 5],
    ])
  })
})

const SEASONS: SeasonRow[] = [
  { id: 's2025', year: 2025, name: '2025', state: 'closed' },
  { id: 's2026', year: 2026, name: '2026', state: 'active' },
  { id: 's2027', year: 2027, name: '2027', state: 'preseason' },
]

describe('resolveCurrentSeason (mirrors the view CTE: non-closed, max year)', () => {
  it('picks the highest-year non-closed season', () => {
    expect(resolveCurrentSeason(SEASONS)?.id).toBe('s2027')
  })
  it('ignores closed seasons even when newer', () => {
    const seasons: SeasonRow[] = [
      { id: 'a', year: 2027, name: '2027', state: 'closed' },
      { id: 'b', year: 2026, name: '2026', state: 'active' },
    ]
    expect(resolveCurrentSeason(seasons)?.id).toBe('b')
  })
  it('returns null when every season is closed or the list is empty', () => {
    expect(resolveCurrentSeason([{ id: 'a', year: 2026, name: '2026', state: 'closed' }])).toBeNull()
    expect(resolveCurrentSeason([])).toBeNull()
  })
})

describe('latestSeason (default for the import select)', () => {
  it('picks the highest year regardless of state', () => {
    expect(latestSeason(SEASONS)?.id).toBe('s2027')
    expect(latestSeason([])).toBeNull()
  })
})

describe('candidateName', () => {
  it('joins first and last name, falls back to email', () => {
    expect(candidateName({ first_name: 'Jane', last_name: 'Doe', email: 'j@d.co' })).toBe('Jane Doe')
    expect(candidateName({ first_name: 'Jane', last_name: null, email: 'j@d.co' })).toBe('Jane')
    expect(candidateName({ first_name: '', last_name: '', email: 'j@d.co' })).toBe('j@d.co')
  })
})

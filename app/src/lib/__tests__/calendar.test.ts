import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EVENT_TIME_ZONE,
  bannerDismissKey,
  canEditEvents,
  canMarkAttendance,
  datetimeLocalToIso,
  derivedMilestoneLabel,
  eventAudienceChip,
  eventStatusChip,
  filterPeopleByQuery,
  icsEventUrl,
  icsFeedUrl,
  isoToDatetimeLocal,
  materialChangeBadge,
  personDisplayName,
  pickChangeBanner,
} from '../calendar'

describe('datetimeLocalToIso (America/Denver wall time -> ISO)', () => {
  it('converts a winter (MST, UTC-7) wall time correctly', () => {
    // 2027-03-03 is before the 2027-03-14 DST switch, so Denver is UTC-7
    expect(datetimeLocalToIso('2027-03-03T18:00', 'America/Denver')).toBe('2027-03-04T01:00:00.000Z')
  })

  it('converts a summer (MDT, UTC-6) wall time correctly', () => {
    // 2027-07-01 is daylight time, so Denver is UTC-6
    expect(datetimeLocalToIso('2027-07-01T18:00', 'America/Denver')).toBe('2027-07-02T00:00:00.000Z')
  })

  it('defaults to America/Denver', () => {
    expect(datetimeLocalToIso('2027-03-03T18:00')).toBe(datetimeLocalToIso('2027-03-03T18:00', DEFAULT_EVENT_TIME_ZONE))
  })

  it('round-trips through isoToDatetimeLocal', () => {
    const iso = datetimeLocalToIso('2027-03-06T18:30', 'America/Denver')
    expect(iso).not.toBeNull()
    expect(isoToDatetimeLocal(iso!, 'America/Denver')).toBe('2027-03-06T18:30')
  })

  it('returns null for empty or malformed input', () => {
    expect(datetimeLocalToIso('', 'America/Denver')).toBeNull()
    expect(datetimeLocalToIso('not-a-date', 'America/Denver')).toBeNull()
    expect(datetimeLocalToIso('2027-03-03', 'America/Denver')).toBeNull()
  })

  it('rejects impossible wall times (Feb 30 rolls over)', () => {
    expect(datetimeLocalToIso('2027-02-30T18:00', 'America/Denver')).toBeNull()
  })
})

describe('isoToDatetimeLocal', () => {
  it('formats an ISO instant as Denver wall clock', () => {
    expect(isoToDatetimeLocal('2027-03-04T01:00:00.000Z', 'America/Denver')).toBe('2027-03-03T18:00')
    expect(isoToDatetimeLocal('2027-07-02T00:00:00.000Z', 'America/Denver')).toBe('2027-07-01T18:00')
  })
})

describe('event status/audience chips', () => {
  it('published is green, draft amber, cancelled red', () => {
    expect(eventStatusChip('published').className).toContain('green')
    expect(eventStatusChip('draft').className).toContain('amber')
    expect(eventStatusChip('cancelled').className).toContain('red')
  })

  it('audience chips label each value', () => {
    expect(eventAudienceChip('public').label).toBe('public')
    expect(eventAudienceChip('members').label).toBe('members')
    expect(eventAudienceChip('private').label).toBe('private')
  })

  it('materialChangeBadge only renders when flagged', () => {
    expect(materialChangeBadge(true)?.label).toBe('material change')
    expect(materialChangeBadge(false)).toBeNull()
  })

  it('unknown statuses fall back to a neutral chip', () => {
    expect(eventStatusChip('weird').className).toContain('gray')
  })
})

describe('pickChangeBanner (WF-04 public banner selection)', () => {
  const row = (id: string, updated_at: string, over: Partial<{ material_change: boolean; status: string; audience: string }> = {}) => ({
    id,
    updated_at,
    material_change: true,
    status: 'published',
    audience: 'public',
    ...over,
  })

  it('picks the newest published public material change', () => {
    const rows = [row('a', '2026-11-01T10:00:00Z'), row('b', '2026-11-05T10:00:00Z'), row('c', '2026-11-03T10:00:00Z')]
    expect(pickChangeBanner(rows)?.id).toBe('b')
  })

  it('ignores drafts, non-public audiences and non-material rows', () => {
    const rows = [
      row('draft', '2026-11-09T10:00:00Z', { status: 'draft' }),
      row('private', '2026-11-08T10:00:00Z', { audience: 'private' }),
      row('plain', '2026-11-07T10:00:00Z', { material_change: false }),
    ]
    expect(pickChangeBanner(rows)).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(pickChangeBanner([])).toBeNull()
  })

  it('dismissal key is stable per event', () => {
    expect(bannerDismissKey('evt-1')).toBe('bulldogs:change-banner-dismissed:evt-1')
  })
})

describe('ics urls', () => {
  it('builds the feed url from the base url (trailing slash tolerated)', () => {
    expect(icsFeedUrl('https://example.app')).toBe('https://example.app/functions/events-ics')
    expect(icsFeedUrl('https://example.app/')).toBe('https://example.app/functions/events-ics')
  })

  it('builds the per-event download url with encoded uid', () => {
    expect(icsEventUrl('https://example.app', 'bulldogs-2027-training-01')).toBe(
      'https://example.app/functions/events-ics?uid=bulldogs-2027-training-01'
    )
    expect(icsEventUrl('https://example.app', 'uid with spaces')).toContain('uid=uid%20with%20spaces')
  })
})

describe('person search + labels', () => {
  const people = [
    { id: '1', first_name: 'Aaron', last_name: 'Example', preferred_name: null, email: 'aaron.example@synthetic.test' },
    { id: '2', first_name: 'Bella', last_name: 'Sample', preferred_name: 'Bel', email: 'bella.sample@synthetic.test' },
    { id: '3', first_name: 'Carlos', last_name: 'Demo', preferred_name: null, email: 'carlos.demo@synthetic.test' },
  ]

  it('matches name and email case-insensitively', () => {
    expect(filterPeopleByQuery(people, 'BELLA').map((p) => p.id)).toEqual(['2'])
    expect(filterPeopleByQuery(people, 'synthetic.test').length).toBe(3)
    expect(filterPeopleByQuery(people, 'demo').map((p) => p.id)).toEqual(['3'])
    expect(filterPeopleByQuery(people, 'bel').map((p) => p.id)).toEqual(['2']) // preferred name
  })

  it('empty query returns everyone (up to the limit)', () => {
    expect(filterPeopleByQuery(people, '  ').length).toBe(3)
    expect(filterPeopleByQuery(people, '', 2).length).toBe(2)
  })

  it('display name prefers preferred name, then first+last, then email', () => {
    expect(personDisplayName(people[1])).toBe('Bel')
    expect(personDisplayName(people[0])).toBe('Aaron Example')
    expect(personDisplayName({ first_name: '', last_name: null, preferred_name: null, email: 'x@y.test' })).toBe('x@y.test')
  })

  it('labels derived milestones', () => {
    expect(derivedMilestoneLabel('first_training')).toContain('First training')
    expect(derivedMilestoneLabel('second_training')).toContain('second training')
    expect(derivedMilestoneLabel('other_thing')).toContain('other thing')
  })
})

describe('role gates (mirror the RPC permission checks)', () => {
  it('canEditEvents: calendar_editor/admin only', () => {
    expect(canEditEvents(['calendar_editor'])).toBe(true)
    expect(canEditEvents(['admin'])).toBe(true)
    expect(canEditEvents(['coordinator'])).toBe(false)
    expect(canEditEvents(['volunteer'])).toBe(false)
    expect(canEditEvents([])).toBe(false)
  })

  it('canMarkAttendance: coach/coordinator/admin', () => {
    expect(canMarkAttendance(['coach'])).toBe(true)
    expect(canMarkAttendance(['coordinator'])).toBe(true)
    expect(canMarkAttendance(['admin'])).toBe(true)
    expect(canMarkAttendance(['calendar_editor'])).toBe(false)
    expect(canMarkAttendance(['volunteer'])).toBe(false)
  })
})

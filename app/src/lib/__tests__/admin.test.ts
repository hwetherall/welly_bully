import { describe, expect, it } from 'vitest'
import {
  INITIAL_CALL_DUE_MS,
  displayNameFromUser,
  initialCallDueAt,
  isOverdue,
  notificationStatusChip,
  ownerName,
  stageChip,
  type ClubMemberLike,
} from '../admin'

const MEMBERS: ClubMemberLike[] = [
  { id: 'u-1', email: 'vol@example.test', full_name: 'Vera Volunteer' },
  { id: 'u-2', email: 'coach@example.test', full_name: null },
]

describe('notificationStatusChip', () => {
  it('marks failed as red so delivery problems stay visible (WF-01.7)', () => {
    const chip = notificationStatusChip('failed')
    expect(chip.label).toBe('failed')
    expect(chip.className).toContain('red')
  })

  it('marks dry_run as amber', () => {
    const chip = notificationStatusChip('dry_run')
    expect(chip.label).toBe('dry run')
    expect(chip.className).toContain('amber')
  })

  it('maps the remaining statuses', () => {
    expect(notificationStatusChip('queued').label).toBe('queued')
    expect(notificationStatusChip('sending').label).toBe('sending')
    expect(notificationStatusChip('sent').label).toBe('sent')
    expect(notificationStatusChip('cancelled').label).toBe('cancelled')
  })

  it('falls back to a neutral chip for unknown statuses', () => {
    const chip = notificationStatusChip('something_new')
    expect(chip.label).toBe('something_new')
    expect(chip.className).toContain('gray')
  })
})

describe('stageChip', () => {
  it('badges each plan §6 stage', () => {
    for (const stage of ['new', 'assigned', 'attempted', 'contacted', 'training_planned', 'attended', 'active', 'deferred', 'not_interested', 'dormant', 'archived']) {
      expect(stageChip(stage).label).toBe(stage)
    }
  })

  it('highlights new leads in gold', () => {
    expect(stageChip('new').className).toContain('gold')
  })
})

describe('ownerName', () => {
  it('returns Unassigned when there is no owner', () => {
    expect(ownerName(null, MEMBERS)).toBe('Unassigned')
    expect(ownerName(undefined, MEMBERS)).toBe('Unassigned')
  })

  it('resolves full_name from club_members', () => {
    expect(ownerName('u-1', MEMBERS)).toBe('Vera Volunteer')
  })

  it('falls back to email when full_name is null', () => {
    expect(ownerName('u-2', MEMBERS)).toBe('coach@example.test')
  })

  it('handles an owner missing from the directory', () => {
    expect(ownerName('u-missing', MEMBERS)).toBe('Unknown owner')
  })
})

describe('displayNameFromUser', () => {
  it('prefers user_metadata.full_name', () => {
    expect(
      displayNameFromUser({ id: 'u', email: 'a@b.test', user_metadata: { full_name: 'Ada Admin' } })
    ).toBe('Ada Admin')
  })

  it('accepts metadata.full_name (SDK profile shape)', () => {
    expect(displayNameFromUser({ id: 'u', email: 'a@b.test', metadata: { full_name: 'Mona Meta' } })).toBe('Mona Meta')
  })

  it('falls back to profile.name, then the email prefix', () => {
    expect(displayNameFromUser({ id: 'u', email: 'prefix@b.test', profile: { name: 'Prof Name' } })).toBe('Prof Name')
    expect(displayNameFromUser({ id: 'u', email: 'prefix@b.test' })).toBe('prefix')
    expect(displayNameFromUser({ id: 'u', email: null })).toBe('Club member')
  })
})

describe('initialCallDueAt (P0.4: 48 elapsed hours after receipt)', () => {
  it('is exactly 48 hours after the enquiry timestamp', () => {
    const enquired = '2026-11-08T18:00:00.000Z'
    expect(INITIAL_CALL_DUE_MS).toBe(48 * 60 * 60 * 1000)
    expect(initialCallDueAt(enquired).toISOString()).toBe('2026-11-10T18:00:00.000Z')
  })
})

describe('isOverdue', () => {
  it('compares against now', () => {
    const now = new Date('2026-11-10T18:00:00.000Z')
    expect(isOverdue('2026-11-10T17:59:59.000Z', now)).toBe(true)
    expect(isOverdue('2026-11-10T18:00:00.000Z', now)).toBe(false)
    expect(isOverdue('2026-11-11T00:00:00.000Z', now)).toBe(false)
  })
})

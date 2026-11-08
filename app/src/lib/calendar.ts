// Pure Sprint 4 (plan P1 / WF-04) calendar helpers — UI-free on purpose so vitest
// can cover them: src/lib/__tests__/calendar.test.ts.
// Enum lists mirror migrations (event_type / event_status / event_audience).
import type { Chip } from './admin'

/** events.type enum (core schema migration). */
export const EVENT_TYPES = ['training', 'match', 'tournament', 'social', 'committee', 'fundraiser'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  training: 'Training',
  match: 'Match',
  tournament: 'Tournament',
  social: 'Social',
  committee: 'Committee',
  fundraiser: 'Fundraiser',
}

/** events.status enum. */
export const EVENT_STATUSES = ['draft', 'published', 'cancelled'] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

/** events.audience enum. */
export const EVENT_AUDIENCES = ['public', 'members', 'private'] as const
export type EventAudience = (typeof EVENT_AUDIENCES)[number]

/** Schema default time zone for events (D6): America/Denver. */
export const DEFAULT_EVENT_TIME_ZONE = 'America/Denver'

const CHIP_BASE = 'inline-block rounded px-1.5 py-0.5 text-xs font-bold whitespace-nowrap'

/** Status chip for an events row (draft/published/cancelled). */
export function eventStatusChip(status: string): Chip {
  switch (status) {
    case 'published':
      return { label: 'published', className: `${CHIP_BASE} bg-green-100 text-green-800` }
    case 'draft':
      return { label: 'draft', className: `${CHIP_BASE} bg-amber-100 text-amber-800` }
    case 'cancelled':
      return { label: 'cancelled', className: `${CHIP_BASE} bg-red-100 text-red-800` }
    default:
      return { label: status, className: `${CHIP_BASE} bg-gray-100 text-gray-700` }
  }
}

/** Audience chip for an events row (public/members/private). */
export function eventAudienceChip(audience: string): Chip {
  switch (audience) {
    case 'public':
      return { label: 'public', className: `${CHIP_BASE} bg-blue-100 text-blue-800` }
    case 'members':
      return { label: 'members', className: `${CHIP_BASE} bg-navy-100 text-navy-800` }
    case 'private':
      return { label: 'private', className: `${CHIP_BASE} bg-gray-100 text-gray-700` }
    default:
      return { label: audience, className: `${CHIP_BASE} bg-gray-100 text-gray-700` }
  }
}

/** Material-change badge shown on rows where the server flagged a WF-04 change. */
export function materialChangeBadge(materialChange: boolean): Chip | null {
  if (!materialChange) return null
  return { label: 'material change', className: `${CHIP_BASE} bg-burgundy-100 text-burgundy-800` }
}

//------------------------------------------------------------------------
// Role gates (RPCs enforce the same server-side; these only hide controls)
//------------------------------------------------------------------------

/** upsert_event RPC: calendar_editor/admin only. */
export function canEditEvents(roleNames: string[]): boolean {
  return roleNames.some((r) => r === 'admin' || r === 'calendar_editor')
}

/** mark_attendance RPC: coach/coordinator/admin only. */
export function canMarkAttendance(roleNames: string[]): boolean {
  return roleNames.some((r) => r === 'admin' || r === 'coordinator' || r === 'coach')
}

//------------------------------------------------------------------------
// datetime-local <-> ISO in an event time zone (default America/Denver).
// No date library: wall-clock -> UTC via the zone's UTC offset (two-pass so
// DST transitions resolve), with a round-trip check to reject impossible
// wall times like 2027-02-30T18:00.
//------------------------------------------------------------------------

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function zonedParts(utc: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(utc)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24, // hourCycle h23 can still emit 24 in some ICU builds
    minute: get('minute'),
    second: get('second'),
  }
}

/** UTC offset (ms) of `timeZone` at the given instant: wall-clock-as-UTC minus actual UTC. */
function tzOffsetMs(timeZone: string, utc: Date): number {
  const p = zonedParts(utc, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(utc.getTime() / 1000) * 1000
}

const DATETIME_LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/**
 * Convert an <input type="datetime-local"> value (wall clock) to an ISO
 * timestamptz, interpreting the wall time in `timeZone`. Returns null for
 * empty/malformed input or impossible wall times (round-trip mismatch).
 */
export function datetimeLocalToIso(value: string, timeZone: string = DEFAULT_EVENT_TIME_ZONE): string | null {
  const m = DATETIME_LOCAL_RE.exec(value.trim())
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  const wallUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? '0'))
  // two-pass: offset at the naive guess, then refine at the resolved instant
  let utc = wallUtc - tzOffsetMs(timeZone, new Date(wallUtc))
  utc = wallUtc - tzOffsetMs(timeZone, new Date(utc))
  const dt = new Date(utc)
  if (Number.isNaN(dt.getTime())) return null
  // reject rolled-over dates (e.g. Feb 30) by round-tripping the wall parts
  const p = zonedParts(dt, timeZone)
  if (p.year !== Number(y) || p.month !== Number(mo) || p.day !== Number(d) || p.hour !== Number(h) % 24 || p.minute !== Number(mi)) {
    return null
  }
  return dt.toISOString()
}

/** Format an ISO timestamptz as a datetime-local value (wall clock in `timeZone`). */
export function isoToDatetimeLocal(iso: string, timeZone: string = DEFAULT_EVENT_TIME_ZONE): string {
  const p = zonedParts(new Date(iso), timeZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

//------------------------------------------------------------------------
// Public change banner (WF-04 step 2): latest material change on a published
// public event; dismissal is per event id in localStorage.
//------------------------------------------------------------------------

export interface BannerCandidate {
  id: string
  material_change: boolean
  status: string
  audience: string
  updated_at: string
}

/** Pick the banner event: only published public material changes, newest first. */
export function pickChangeBanner<T extends BannerCandidate>(rows: T[]): T | null {
  const eligible = rows.filter((r) => r.material_change && r.status === 'published' && r.audience === 'public')
  eligible.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  return eligible[0] ?? null
}

export const BANNER_DISMISS_PREFIX = 'bulldogs:change-banner-dismissed:'

/** localStorage key recording that the banner for this event was dismissed. */
export function bannerDismissKey(eventId: string): string {
  return BANNER_DISMISS_PREFIX + eventId
}

//------------------------------------------------------------------------
// Public .ics feed URLs (functions/events-ics.ts; plan P1.2)
//------------------------------------------------------------------------

/** All published public events as a subscribable feed. */
export function icsFeedUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/functions/events-ics`
}

/** Single-event "Add to calendar" download (Content-Disposition attachment). */
export function icsEventUrl(baseUrl: string, uid: string): string {
  return `${icsFeedUrl(baseUrl)}?uid=${encodeURIComponent(uid)}`
}

//------------------------------------------------------------------------
// Attendance person search + derived-milestone labels (plan P1.4)
//------------------------------------------------------------------------

export interface PersonLike {
  first_name: string
  last_name: string | null
  preferred_name: string | null
  email: string
}

/** Display name for a person row: preferred name, then first + last, then email. */
export function personDisplayName(p: PersonLike): string {
  const preferred = p.preferred_name?.trim()
  if (preferred) return preferred
  const full = [p.first_name?.trim(), p.last_name?.trim()].filter(Boolean).join(' ')
  return full || p.email
}

/** Case-insensitive name/email contains filter for the attendance person select. */
export function filterPeopleByQuery<T extends PersonLike>(rows: T[], query: string, limit = 20): T[] {
  const q = query.trim().toLowerCase()
  const matched = q === ''
    ? rows
    : rows.filter((r) =>
        [r.first_name, r.last_name, r.preferred_name, r.email].some((v) => v?.toLowerCase().includes(q))
      )
  return matched.slice(0, limit)
}

/** Human label for a milestone derived by mark_attendance (plan funnel steps 7-8). */
export function derivedMilestoneLabel(type: string): string {
  switch (type) {
    case 'first_training':
      return 'First training milestone recorded'
    case 'second_training':
      return 'Returning trainee milestone (second training) recorded'
    default:
      return `Milestone recorded: ${type.replace(/_/g, ' ')}`
  }
}

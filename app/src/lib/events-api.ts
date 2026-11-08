// Thin wrappers over the Sprint 4 calendar/attendance reads + SQL RPCs
// (migrations/20261108202413_sprint4-calendar-attendance.sql). All RPCs are
// SECURITY DEFINER and permission-checked server-side (upsert_event:
// calendar_editor/admin; mark_attendance: coach/coordinator/admin;
// queue_event_update_notice: coordinator/admin); each writes audit_events.
import { insforge } from './insforge'
import type { RpcResult } from './crm-api'
import type {
  AdminEventRow,
  AttendanceRow,
  MarkAttendanceResult,
  PersonSearchRow,
  QueueNoticeResult,
} from './types'

export interface TableResult<T> {
  data: T[]
  error: { message: string } | null
}

const EVENT_COLUMNS =
  'id, uid, type, title, venue, venue_url, starts_at, ends_at, time_zone, description, status, audience, revision, material_change, change_note, created_at, updated_at'

/** All events (any status/audience), newest start first. Staff RLS: calendar_editor/admin
 * get full read via the "events fully visible to editors" policy. */
export async function fetchAllEvents(): Promise<TableResult<AdminEventRow>> {
  const { data, error } = await insforge.database
    .from('events')
    .select(EVENT_COLUMNS)
    .order('starts_at', { ascending: false })
  return { data: (data ?? []) as AdminEventRow[], error: error ? { message: error.message } : null }
}

/** Attendance rows for one event with the person embed (staff RLS: coach/coordinator/admin). */
export async function fetchAttendance(eventId: string): Promise<TableResult<AttendanceRow>> {
  const { data, error } = await insforge.database
    .from('attendance')
    .select('id, event_id, person_id, walk_in, consent_recorded, checked_in_at, person:people(first_name, last_name, preferred_name, email)')
    .eq('event_id', eventId)
    .order('checked_in_at', { ascending: true })
  return { data: (data ?? []) as AttendanceRow[], error: error ? { message: error.message } : null }
}

/** People for the attendance search select (staff RLS: admin/coordinator/coach or assignee). */
export async function fetchPeople(limit = 200): Promise<TableResult<PersonSearchRow>> {
  const { data, error } = await insforge.database
    .from('people')
    .select('id, first_name, last_name, preferred_name, email')
    .is('deleted_at', null)
    .order('last_name', { ascending: true, nullsFirst: false })
    .order('first_name', { ascending: true })
    .limit(limit)
  return { data: (data ?? []) as PersonSearchRow[], error: error ? { message: error.message } : null }
}

//------------------------------------------------------------------------
// RPCs
//------------------------------------------------------------------------

export interface UpsertEventInput {
  id: string | null
  type: string
  title: string
  venue: string | null
  venue_url: string | null
  starts_at: string // ISO timestamptz
  ends_at: string
  time_zone: string
  description: string | null
  status: string
  audience: string
  change_note: string | null
}

/** rpc upsert_event(...) — create (id null) or update; server bumps revision and
 * flags material_change on published events. Returns the event row as JSONB. */
export function upsertEvent(input: UpsertEventInput): Promise<RpcResult<AdminEventRow>> {
  return insforge.database.rpc('upsert_event', {
    p_id: input.id,
    p_type: input.type,
    p_title: input.title,
    p_venue: input.venue,
    p_venue_url: input.venue_url,
    p_starts_at: input.starts_at,
    p_ends_at: input.ends_at,
    p_time_zone: input.time_zone,
    p_description: input.description,
    p_status: input.status,
    p_audience: input.audience,
    p_change_note: input.change_note,
  }) as unknown as Promise<RpcResult<AdminEventRow>>
}

/** rpc mark_attendance(...) — upsert per (event, person); derives first/second_training. */
export function markAttendance(
  eventId: string,
  personId: string,
  walkIn: boolean,
  consentRecorded: boolean
): Promise<RpcResult<MarkAttendanceResult>> {
  return insforge.database.rpc('mark_attendance', {
    p_event_id: eventId,
    p_person_id: personId,
    p_walk_in: walkIn,
    p_consent_recorded: consentRecorded,
  }) as unknown as Promise<RpcResult<MarkAttendanceResult>>
}

/** rpc queue_event_update_notice(p_event_id) — WF-04 step 4, coordinator/admin only.
 * Queues operational_notice jobs for consented participants; delivery stays in the
 * notification queue (dry-run until approved — plan D4). */
export function queueEventUpdateNotice(eventId: string): Promise<RpcResult<QueueNoticeResult>> {
  return insforge.database.rpc('queue_event_update_notice', { p_event_id: eventId }) as unknown as Promise<RpcResult<QueueNoticeResult>>
}

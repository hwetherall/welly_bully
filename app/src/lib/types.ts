// Row shapes for the tables this shell reads.
// Mirrors migrations/20261107211910_bulldogs-core-schema.sql — keep in sync.

/** Published public event as exposed to anon (RLS-limited SELECT). */
export interface PublicEvent {
  id: string
  type: string
  title: string
  venue: string | null
  venue_url: string | null
  starts_at: string
  ends_at: string
  time_zone: string
  description: string | null
}

/** Full events row as staff (calendar_editor/admin) select it — includes the
 * Sprint 4 change-tracking columns (migration ..._sprint4-calendar-attendance.sql). */
export interface AdminEventRow {
  id: string
  uid: string
  type: string
  title: string
  venue: string | null
  venue_url: string | null
  starts_at: string
  ends_at: string
  time_zone: string
  description: string | null
  status: string
  audience: string
  revision: number
  material_change: boolean
  change_note: string | null
  created_at: string
  updated_at: string
}

/** Published public event incl. the columns the landing page needs for the
 * change banner and .ics links (uid for the feed, material_change/change_note
 * for the banner). Anon RLS exposes published public rows only. */
export interface PublicEventRow extends PublicEvent {
  uid: string
  status: string
  audience: string
  revision: number
  material_change: boolean
  change_note: string | null
  updated_at: string
}

/** Row of public.attendance with the person embed (PostgREST may type the
 * to-one embed as an array — normalize with toOne). */
export interface AttendanceRow {
  id: string
  event_id: string
  person_id: string
  walk_in: boolean
  consent_recorded: boolean
  checked_in_at: string
  person:
    | { first_name: string; last_name: string | null; preferred_name: string | null; email: string }
    | { first_name: string; last_name: string | null; preferred_name: string | null; email: string }[]
    | null
}

/** Minimal person row for the attendance person search (staff RLS). */
export interface PersonSearchRow {
  id: string
  first_name: string
  last_name: string | null
  preferred_name: string | null
  email: string
}

/** JSONB returned by rpc public.mark_attendance (Sprint 4 migration). */
export interface MarkAttendanceResult {
  attendance: AttendanceRow
  milestones_derived: string[]
  total_attendance_count: number
}

/** JSONB returned by rpc public.queue_event_update_notice (WF-04 step 4). */
export interface QueueNoticeResult {
  ok: boolean
  event_id: string
  revision: number
  notices_queued: number
  idempotency_key: string
}

/** Row of the public.action_queue view (plan P0.6). */
export interface ActionQueueRow {
  task_id: string
  task_type: string
  task_state: string
  due_at: string
  overdue: boolean
  person_id: string
  first_name: string
  last_name: string | null
  email: string
  phone: string | null
  enquiry_id: string | null
  enquiry_stage: string | null
  utm_source: string | null
  enquired_at: string
  owner_id: string | null
}

/** Row of public.enquiries as the admin dashboard selects it
 * (`person:people(first_name,last_name,email)` embed; PostgREST may type the
 * to-one embed as an array, so normalize at runtime). */
export interface EnquiryRow {
  id: string
  stage: string
  created_at: string
  assigned_to: string | null
  utm_source: string | null
  person:
    | { first_name: string; last_name: string | null; email: string }
    | { first_name: string; last_name: string | null; email: string }[]
    | null
}

/** Row of public.notification_jobs as the admin dashboard selects it. */
export interface NotificationJobRow {
  id: string
  type: string
  to_email: string
  status: string
  attempts: number
  created_at: string
  last_error: string | null
}

/** Row of public.club_members (staff directory; readable by club users). */
export interface ClubMember {
  id: string
  email: string
  full_name: string | null
}

//------------------------------------------------------------------------
// Sprint 2 (P0.5/P0.6): volunteer CRM + coordinator scoreboard row shapes
//------------------------------------------------------------------------

/** Row of public.people as the lead detail selects it. */
export interface PersonRow {
  id: string
  first_name: string
  last_name: string | null
  preferred_name: string | null
  email: string
  phone: string | null
  consent_contact: boolean
  consent_at: string | null
  consent_text_version: string
  contact_opt_out: boolean
  source: string | null
  created_at: string
}

/** Row of public.enquiries with the person embed, as the CRM list/detail select it.
 * PostgREST may type the to-one embed as an array, so normalize at runtime. */
export interface EnquiryDetailRow {
  id: string
  person_id: string
  season_id: string
  stage: string
  stage_updated_at: string
  assigned_to: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  channel: string
  answers: Record<string, unknown>
  created_at: string
  person: PersonRow | PersonRow[] | null
}

/** Row of public.enquiries as the leads list selects it (person embed, subset). */
export interface LeadListRow {
  id: string
  person_id: string
  stage: string
  created_at: string
  assigned_to: string | null
  utm_source: string | null
  person:
    | { first_name: string; last_name: string | null; email: string }
    | { first_name: string; last_name: string | null; email: string }[]
    | null
}

/** Row of public.tasks. */
export interface TaskRow {
  id: string
  person_id: string
  enquiry_id: string | null
  type: string
  state: string
  owner_id: string | null
  due_at: string
  outcome: string | null
  notes: string | null
  completed_at: string | null
  created_at: string
}

/** Row of public.interactions. */
export interface InteractionRow {
  id: string
  person_id: string
  enquiry_id: string | null
  author_id: string
  type: string
  outcome: string | null
  summary: string
  next_action: string | null
  next_action_due: string | null
  created_at: string
}

/** Row of public.audit_events. */
export interface AuditEventRow {
  id: string
  actor_id: string | null
  action: string
  table_name: string | null
  record_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  created_at: string
}

/** Row of public.milestones. */
export interface MilestoneRow {
  id: string
  person_id: string
  season_id: string
  type: string
  achieved_at: string
  source: string | null
  recorded_by: string
  notes: string | null
  created_at: string
}

/** JSONB returned by rpc public.recruitment_stats(p_since) — aggregate only, no PII. */
export interface RecruitmentStats {
  since: string
  enquiries_by_stage: Record<string, number>
  enquiries_by_source_window: Record<string, number>
  new_enquiries_in_window: number
  unassigned_enquiries: number
  overdue_open_tasks: number
  median_hours_to_first_attempt: number
  pct_attempted_within_48h: number | null
  first_training_attendance_window: number
  first_training_conversion_window: number | null
}

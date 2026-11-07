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

// Pure CRM/scoreboard helpers for Sprint 2 (plan P0.5/P0.6).
// UI-free on purpose so vitest can cover them — see src/lib/__tests__/crm.test.ts.
// Enum lists mirror the migrations (enquiry_stage, interaction_type, milestone_type).

/** enquiry_stage enum (migrations/20261107211910_bulldogs-core-schema.sql, plan §6). */
export const ENQUIRY_STAGES = [
  'new',
  'assigned',
  'attempted',
  'contacted',
  'training_planned',
  'attended',
  'active',
  'deferred',
  'not_interested',
  'dormant',
  'archived',
] as const

export type EnquiryStage = (typeof ENQUIRY_STAGES)[number]

/** Select options for the stage editor, in funnel order. */
export const STAGE_OPTIONS: { value: EnquiryStage; label: string }[] = ENQUIRY_STAGES.map((s) => ({
  value: s,
  label: s.replace(/_/g, ' '),
}))

/** interaction_type enum. */
export const INTERACTION_TYPES = ['call', 'email', 'meeting', 'whatsapp', 'social', 'other'] as const
export type InteractionType = (typeof INTERACTION_TYPES)[number]

export const INTERACTION_TYPE_LABELS: Record<InteractionType, string> = {
  call: 'Phone call',
  email: 'Email',
  meeting: 'In person / meeting',
  whatsapp: 'WhatsApp',
  social: 'Social media',
  other: 'Other',
}

/** Common task outcomes for the "mark completed" select (tasks.outcome is free text). */
export const TASK_OUTCOMES = [
  'reached',
  'voicemail',
  'no_answer',
  'booked_training',
  'not_interested',
  'other',
] as const

/** milestone_type enum. */
export const MILESTONE_TYPES = [
  'whatsapp_invited',
  'whatsapp_joined',
  'usafl_registered',
  'dues_paid',
  'first_social',
  'first_match',
  'nationals_roster',
  'nationals_played',
  'season_return',
  'membership_active',
] as const

export type MilestoneType = (typeof MILESTONE_TYPES)[number]

export const MILESTONE_LABELS: Record<MilestoneType, string> = {
  whatsapp_invited: 'WhatsApp invitation offered',
  whatsapp_joined: 'WhatsApp joined',
  usafl_registered: 'USAFL registration verified',
  dues_paid: 'Club dues verified',
  first_social: 'First social event',
  first_match: 'First match played',
  nationals_roster: 'Nationals roster',
  nationals_played: 'Nationals appearance',
  season_return: 'Season return',
  membership_active: 'Membership active',
}

/** Pathway from the latest enquiry's form answers (enquiries.answers JSONB). */
export function pathwayFromAnswers(answers: unknown): string {
  if (answers && typeof answers === 'object') {
    const pathway = (answers as Record<string, unknown>).pathway
    if (typeof pathway === 'string' && pathway.trim()) return pathway.trim()
  }
  return '—'
}

//------------------------------------------------------------------------
// Leads list filtering (P0.5/P0.6 filters: owner, stage, source, overdue-only)
//------------------------------------------------------------------------

/** Minimal shape a lead row must have to be filterable. */
export interface LeadFilterable {
  assigned_to: string | null
  stage: string
  utm_source: string | null
  /** earliest open/attempted task due_at for this lead, null when none */
  next_task_due_at: string | null
  /** whether that next task is still open/attempted (overdue derives from due_at) */
  next_task_open: boolean
}

export interface LeadFilters {
  /** owner user id, '__unassigned__' for unassigned, '' for any */
  owner: string
  stage: string
  source: string
  overdueOnly: boolean
}

export const EMPTY_LEAD_FILTERS: LeadFilters = { owner: '', stage: '', source: '', overdueOnly: false }

/** Sentinel option value for the owner filter meaning "no owner". */
export const UNASSIGNED_FILTER = '__unassigned__'

export function filterLeads<T extends LeadFilterable>(rows: T[], f: LeadFilters, now: Date = new Date()): T[] {
  return rows.filter((r) => {
    if (f.owner === UNASSIGNED_FILTER) {
      if (r.assigned_to) return false
    } else if (f.owner && r.assigned_to !== f.owner) {
      return false
    }
    if (f.stage && r.stage !== f.stage) return false
    if (f.source && (r.utm_source ?? '') !== f.source) return false
    if (f.overdueOnly) {
      if (!r.next_task_open || !r.next_task_due_at) return false
      if (new Date(r.next_task_due_at).getTime() >= now.getTime()) return false
    }
    return true
  })
}

/** Distinct non-empty utm_source values present in the rows, sorted, for the filter select. */
export function sourceOptions(rows: { utm_source: string | null }[]): string[] {
  const set = new Set<string>()
  for (const r of rows) if (r.utm_source) set.add(r.utm_source)
  return [...set].sort((a, b) => a.localeCompare(b))
}

//------------------------------------------------------------------------
// Next-task computation for a lead
//------------------------------------------------------------------------

export interface TaskLike {
  enquiry_id: string | null
  person_id: string
  state: string
  due_at: string
}

/** Earliest still-open (open/attempted) task for a lead, matched by enquiry_id or
 * person_id (person-level tasks have enquiry_id NULL). Null when nothing is open. */
export function nextOpenTask<T extends TaskLike>(
  tasks: T[],
  lead: { id: string; person_id: string }
): T | null {
  const open = tasks.filter(
    (t) => (t.enquiry_id === lead.id || (t.enquiry_id === null && t.person_id === lead.person_id)) && (t.state === 'open' || t.state === 'attempted')
  )
  open.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())
  return open[0] ?? null
}

//------------------------------------------------------------------------
// Activity timeline: merge interactions + audit_events + tasks (+ milestones)
//------------------------------------------------------------------------

export interface InteractionLike {
  id: string
  type: string
  outcome: string | null
  summary: string
  created_at: string
}

export interface AuditLike {
  id: string
  action: string
  table_name: string | null
  record_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  created_at: string
}

export interface TimelineTaskLike {
  id: string
  type: string
  state: string
  outcome: string | null
  due_at: string
  completed_at: string | null
  created_at: string
}

export interface MilestoneLike {
  id: string
  type: string
  achieved_at: string
  notes: string | null
}

export type TimelineKind = 'interaction' | 'audit' | 'task' | 'milestone'

export interface TimelineItem {
  id: string
  /** ISO timestamp used for sorting */
  at: string
  kind: TimelineKind
  label: string
  detail: string | null
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '—' : String(v))

/** Human-readable label for an audit_events row (action + before/after JSONB). */
export function describeAuditEvent(
  action: string,
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null
): string {
  switch (action) {
    case 'enquiry.created':
      return 'Enquiry submitted'
    case 'stage.changed':
      return `Stage changed: ${str(before?.stage)} → ${str(after?.stage)}`
    case 'interaction.logged':
      return 'Interaction logged'
    case 'task.completed':
      return after?.outcome ? `Task completed (${str(after.outcome)})` : 'Task completed'
    case 'enquiry.reassigned':
      return 'Lead reassigned to a new volunteer'
    default:
      return action.replace(/\./g, ' ')
  }
}

/** Merge the per-lead activity sources into one timeline, newest first.
 * Ties break on id so the order is deterministic (and testable). */
export function buildTimeline(input: {
  interactions?: InteractionLike[]
  audits?: AuditLike[]
  tasks?: TimelineTaskLike[]
  milestones?: MilestoneLike[]
}): TimelineItem[] {
  const items: TimelineItem[] = []
  for (const i of input.interactions ?? []) {
    items.push({
      id: `interaction-${i.id}`,
      at: i.created_at,
      kind: 'interaction',
      label: `Logged ${INTERACTION_TYPE_LABELS[i.type as InteractionType] ?? i.type}${i.outcome ? ` — ${i.outcome}` : ''}`,
      detail: i.summary,
    })
  }
  for (const a of input.audits ?? []) {
    items.push({
      id: `audit-${a.id}`,
      at: a.created_at,
      kind: 'audit',
      label: describeAuditEvent(a.action, a.before, a.after),
      detail: a.table_name ? `${a.table_name}${a.record_id ? ` ${a.record_id.slice(0, 8)}…` : ''}` : null,
    })
  }
  for (const t of input.tasks ?? []) {
    items.push({
      id: `task-${t.id}`,
      at: t.completed_at ?? t.created_at,
      kind: 'task',
      label: `Task ${t.type.replace(/_/g, ' ')} — ${t.state}${t.outcome ? ` (${t.outcome})` : ''}`,
      detail: `Due ${t.due_at}`,
    })
  }
  for (const m of input.milestones ?? []) {
    items.push({
      id: `milestone-${m.id}`,
      at: m.achieved_at,
      kind: 'milestone',
      label: `Milestone: ${MILESTONE_LABELS[m.type as MilestoneType] ?? m.type.replace(/_/g, ' ')}`,
      detail: m.notes,
    })
  }
  items.sort((a, b) => {
    const d = new Date(b.at).getTime() - new Date(a.at).getTime()
    return d !== 0 ? d : a.id.localeCompare(b.id)
  })
  return items
}

//------------------------------------------------------------------------
// Coordinator scoreboard helpers (P0.6, plan §7 metric definitions)
//------------------------------------------------------------------------

export const STATS_WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const

/** p_since for rpc recruitment_stats(p_since): now minus `days` days, ISO. */
export function statsSinceIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
}

/** jsonb object from recruitment_stats → sorted [key, count] pairs, descending. */
export function sortedCountEntries(obj: Record<string, unknown> | null | undefined): [string, number][] {
  if (!obj || typeof obj !== 'object') return []
  return Object.entries(obj)
    .map(([k, v]) => [k, Number(v)] as [string, number])
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => b[1] - a[1])
}

/** Percentage display: null (no data) renders as an em dash, not 0%. */
export function formatPct(v: unknown): string {
  const n = Number(v)
  return v == null || !Number.isFinite(n) ? '—' : `${n}%`
}

//------------------------------------------------------------------------
// Role helpers
//------------------------------------------------------------------------

export interface UserRoleRowLike {
  user_id: string
  roles: { name: string } | { name: string }[] | null
}

/** user_ids holding the volunteer role, from a user_roles+roles embed query. */
export function volunteerIdsFromRoleRows(rows: UserRoleRowLike[]): string[] {
  const ids: string[] = []
  for (const r of rows) {
    const role = Array.isArray(r.roles) ? r.roles[0] : r.roles
    if (role?.name === 'volunteer') ids.push(r.user_id)
  }
  return ids
}

/** Coordinator/admin gate used to show reassign + milestone quick-log controls. */
export function canCoordinate(roleNames: string[]): boolean {
  return roleNames.includes('admin') || roleNames.includes('coordinator')
}

/** Milestones are readable by admin/coordinator/coach (RLS), writable by admin/coordinator. */
export function canReadMilestones(roleNames: string[]): boolean {
  return roleNames.some((r) => r === 'admin' || r === 'coordinator' || r === 'coach')
}

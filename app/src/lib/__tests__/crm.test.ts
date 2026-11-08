import { describe, expect, it } from 'vitest'
import {
  EMPTY_LEAD_FILTERS,
  ENQUIRY_STAGES,
  MILESTONE_TYPES,
  STAGE_OPTIONS,
  UNASSIGNED_FILTER,
  buildTimeline,
  canCoordinate,
  canReadMilestones,
  describeAuditEvent,
  filterLeads,
  formatPct,
  nextOpenTask,
  pathwayFromAnswers,
  sortedCountEntries,
  sourceOptions,
  statsSinceIso,
  volunteerIdsFromRoleRows,
  type LeadFilterable,
} from '../crm'

describe('STAGE_OPTIONS (enquiry_stage enum, plan §6)', () => {
  it('covers all 11 stages in funnel order', () => {
    expect(STAGE_OPTIONS.map((s) => s.value)).toEqual([...ENQUIRY_STAGES])
    expect(ENQUIRY_STAGES).toHaveLength(11)
    expect(ENQUIRY_STAGES[0]).toBe('new')
    expect(ENQUIRY_STAGES[10]).toBe('archived')
  })

  it('humanizes underscores in labels', () => {
    const trainingPlanned = STAGE_OPTIONS.find((s) => s.value === 'training_planned')
    expect(trainingPlanned?.label).toBe('training planned')
  })

  it('milestone enum has 10 types', () => {
    expect(MILESTONE_TYPES).toHaveLength(10)
  })
})

describe('pathwayFromAnswers', () => {
  it('reads pathway from enquiry answers JSONB', () => {
    expect(pathwayFromAnswers({ pathway: 'womens' })).toBe('womens')
  })
  it('trims and falls back to em dash', () => {
    expect(pathwayFromAnswers({ pathway: '  social ' })).toBe('social')
    expect(pathwayFromAnswers({})).toBe('—')
    expect(pathwayFromAnswers(null)).toBe('—')
    expect(pathwayFromAnswers('womens')).toBe('—')
    expect(pathwayFromAnswers({ pathway: 42 })).toBe('—')
  })
})

interface Row extends LeadFilterable {
  id: string
}

const ROWS: Row[] = [
  { id: 'a', assigned_to: 'u-1', stage: 'new', utm_source: 'instagram', next_task_due_at: '2026-11-01T00:00:00Z', next_task_open: true },
  { id: 'b', assigned_to: 'u-2', stage: 'contacted', utm_source: 'instagram', next_task_due_at: '2026-12-01T00:00:00Z', next_task_open: true },
  { id: 'c', assigned_to: null, stage: 'new', utm_source: null, next_task_due_at: null, next_task_open: false },
  { id: 'd', assigned_to: 'u-1', stage: 'attended', utm_source: 'friend', next_task_due_at: '2026-10-01T00:00:00Z', next_task_open: true },
]

const NOW = new Date('2026-11-10T00:00:00Z')

describe('filterLeads', () => {
  it('returns everything with empty filters', () => {
    expect(filterLeads(ROWS, EMPTY_LEAD_FILTERS, NOW)).toHaveLength(4)
  })

  it('filters by owner', () => {
    expect(filterLeads(ROWS, { ...EMPTY_LEAD_FILTERS, owner: 'u-1' }, NOW).map((r) => r.id)).toEqual(['a', 'd'])
  })

  it('filters unassigned via the sentinel', () => {
    expect(filterLeads(ROWS, { ...EMPTY_LEAD_FILTERS, owner: UNASSIGNED_FILTER }, NOW).map((r) => r.id)).toEqual(['c'])
  })

  it('filters by stage and source', () => {
    expect(filterLeads(ROWS, { ...EMPTY_LEAD_FILTERS, stage: 'new' }, NOW).map((r) => r.id)).toEqual(['a', 'c'])
    expect(filterLeads(ROWS, { ...EMPTY_LEAD_FILTERS, source: 'instagram' }, NOW).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('overdue-only keeps leads with an open task already past due', () => {
    const result = filterLeads(ROWS, { ...EMPTY_LEAD_FILTERS, overdueOnly: true }, NOW)
    expect(result.map((r) => r.id)).toEqual(['a', 'd'])
  })

  it('combines filters', () => {
    const result = filterLeads(ROWS, { owner: 'u-1', stage: 'attended', source: 'friend', overdueOnly: true }, NOW)
    expect(result.map((r) => r.id)).toEqual(['d'])
  })
})

describe('sourceOptions', () => {
  it('returns distinct non-empty sources sorted', () => {
    expect(sourceOptions([{ utm_source: 'b' }, { utm_source: 'a' }, { utm_source: null }, { utm_source: 'b' }])).toEqual(['a', 'b'])
  })
})

describe('nextOpenTask', () => {
  const tasks = [
    { enquiry_id: 'e1', person_id: 'p1', state: 'completed', due_at: '2026-11-01T00:00:00Z' },
    { enquiry_id: 'e1', person_id: 'p1', state: 'open', due_at: '2026-11-05T00:00:00Z' },
    { enquiry_id: 'e1', person_id: 'p1', state: 'attempted', due_at: '2026-11-03T00:00:00Z' },
    { enquiry_id: null, person_id: 'p1', state: 'open', due_at: '2026-11-20T00:00:00Z' },
    { enquiry_id: 'e2', person_id: 'p2', state: 'open', due_at: '2026-11-02T00:00:00Z' },
  ]

  it('picks the earliest open/attempted task for the enquiry, ignoring completed', () => {
    const next = nextOpenTask(tasks, { id: 'e1', person_id: 'p1' })
    expect(next?.due_at).toBe('2026-11-03T00:00:00Z')
  })

  it('matches person-level tasks (enquiry_id null) by person_id', () => {
    const next = nextOpenTask(tasks, { id: 'e9', person_id: 'p1' })
    // e9 has no enquiry-linked open task except via person-level fallback
    expect(next?.due_at).toBe('2026-11-20T00:00:00Z')
  })

  it('returns null when nothing is open', () => {
    expect(nextOpenTask(tasks, { id: 'none', person_id: 'pX' })).toBeNull()
  })
})

describe('describeAuditEvent', () => {
  it('humanizes known actions', () => {
    expect(describeAuditEvent('enquiry.created')).toBe('Enquiry submitted')
    expect(describeAuditEvent('stage.changed', { stage: 'new' }, { stage: 'contacted' })).toBe('Stage changed: new → contacted')
    expect(describeAuditEvent('task.completed', null, { outcome: 'reached' })).toBe('Task completed (reached)')
    expect(describeAuditEvent('task.completed', null, {})).toBe('Task completed')
    expect(describeAuditEvent('enquiry.reassigned')).toBe('Lead reassigned to a new volunteer')
  })

  it('falls back to the raw action with dots replaced', () => {
    expect(describeAuditEvent('custom.thing')).toBe('custom thing')
  })
})

describe('buildTimeline', () => {
  it('merges interactions, audits, tasks and milestones newest-first', () => {
    const items = buildTimeline({
      interactions: [{ id: 'i1', type: 'call', outcome: 'reached', summary: 'Chatted', created_at: '2026-11-08T10:00:00Z' }],
      audits: [
        { id: 'a1', action: 'stage.changed', table_name: 'enquiries', record_id: 'e1', before: { stage: 'new' }, after: { stage: 'contacted' }, created_at: '2026-11-09T10:00:00Z' },
        { id: 'a2', action: 'enquiry.created', table_name: 'enquiries', record_id: 'e1', before: null, after: null, created_at: '2026-11-07T10:00:00Z' },
      ],
      tasks: [{ id: 't1', type: 'make_initial_call', state: 'open', outcome: null, due_at: '2026-11-09T12:00:00Z', completed_at: null, created_at: '2026-11-07T11:00:00Z' }],
      milestones: [{ id: 'm1', type: 'whatsapp_joined', achieved_at: '2026-11-08T12:00:00Z', notes: 'verified' }],
    })
    expect(items.map((i) => i.id)).toEqual(['audit-a1', 'milestone-m1', 'interaction-i1', 'task-t1', 'audit-a2'])
    expect(items[0].label).toBe('Stage changed: new → contacted')
    expect(items[2].label).toBe('Logged Phone call — reached')
    expect(items[2].detail).toBe('Chatted')
    expect(items[4].label).toBe('Enquiry submitted')
  })

  it('sorts by timestamp descending and is deterministic on ties', () => {
    const items = buildTimeline({
      interactions: [
        { id: 'i1', type: 'call', outcome: null, summary: 'a', created_at: '2026-11-08T10:00:00Z' },
        { id: 'i2', type: 'email', outcome: null, summary: 'b', created_at: '2026-11-08T10:00:00Z' },
      ],
    })
    expect(items.map((i) => i.id)).toEqual(['interaction-i1', 'interaction-i2'])
  })

  it('handles empty input', () => {
    expect(buildTimeline({})).toEqual([])
  })
})

describe('stats helpers', () => {
  it('statsSinceIso subtracts the window from now', () => {
    const now = new Date('2026-11-10T00:00:00.000Z')
    expect(statsSinceIso(7, now)).toBe('2026-11-03T00:00:00.000Z')
    expect(statsSinceIso(30, now)).toBe('2026-10-11T00:00:00.000Z')
    expect(statsSinceIso(90, now)).toBe('2026-08-12T00:00:00.000Z')
  })

  it('sortedCountEntries sorts descending and coerces numbers', () => {
    expect(sortedCountEntries({ new: 3, contacted: 5, archived: '2' })).toEqual([
      ['contacted', 5],
      ['new', 3],
      ['archived', 2],
    ])
    expect(sortedCountEntries(null)).toEqual([])
    expect(sortedCountEntries(undefined)).toEqual([])
  })

  it('formatPct renders null as em dash, not 0%', () => {
    expect(formatPct(null)).toBe('—')
    expect(formatPct(66.7)).toBe('66.7%')
    expect(formatPct('12.5')).toBe('12.5%')
  })
})

describe('role helpers', () => {
  it('volunteerIdsFromRoleRows keeps only volunteer role rows (object or array embed)', () => {
    const ids = volunteerIdsFromRoleRows([
      { user_id: 'u1', roles: { name: 'volunteer' } },
      { user_id: 'u2', roles: [{ name: 'admin' }] },
      { user_id: 'u3', roles: [{ name: 'volunteer' }] },
      { user_id: 'u4', roles: null },
    ])
    expect(ids).toEqual(['u1', 'u3'])
  })

  it('canCoordinate is admin/coordinator only', () => {
    expect(canCoordinate(['admin'])).toBe(true)
    expect(canCoordinate(['coordinator'])).toBe(true)
    expect(canCoordinate(['volunteer'])).toBe(false)
    expect(canCoordinate(['coach'])).toBe(false)
    expect(canCoordinate([])).toBe(false)
  })

  it('canReadMilestones includes coach (RLS read) but not volunteer', () => {
    expect(canReadMilestones(['coach'])).toBe(true)
    expect(canReadMilestones(['coordinator'])).toBe(true)
    expect(canReadMilestones(['volunteer'])).toBe(false)
  })
})

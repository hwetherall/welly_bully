import { useEffect, useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { insforge } from '../../lib/insforge'
import { formatTimestamp } from '../../lib/format'
import { isOverdue, ownerName, stageChip, toOne } from '../../lib/admin'
import { Panel, type PanelState } from '../../components/admin-chrome'
import { useClubAuth } from '../../hooks/useClubAuth'
import {
  EMPTY_LEAD_FILTERS,
  STAGE_OPTIONS,
  UNASSIGNED_FILTER,
  filterLeads,
  nextOpenTask,
  sourceOptions,
  volunteerIdsFromRoleRows,
  type LeadFilters,
} from '../../lib/crm'
import type { LeadListRow, TaskRow } from '../../lib/types'

export const Route = createFileRoute('/admin/leads')({
  component: LeadsPage,
})

interface LeadRow extends LeadListRow {
  next_task_due_at: string | null
  next_task_open: boolean
}

// /admin/leads — CRM lead list (plan P0.5/P0.6). Filters: owner (volunteers from
// club_members × user_roles), stage, utm_source, overdue-only. Row click → detail.
function LeadsPage() {
  const { members } = useClubAuth()
  const [leads, setLeads] = useState<PanelState<LeadRow[]>>({ status: 'loading' })
  const [volunteerIds, setVolunteerIds] = useState<string[]>([])
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_LEAD_FILTERS)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLeads({ status: 'loading' })

      // Leads: latest 200 enquiries with the person embed
      const { data: enquiryRows, error: enquiriesError } = await insforge.database
        .from('enquiries')
        .select('id,person_id,stage,created_at,assigned_to,utm_source,person:people(first_name,last_name,email)')
        .order('created_at', { ascending: false })
        .limit(200)
      if (cancelled) return
      if (enquiriesError) {
        setLeads({ status: 'error', error: enquiriesError.message })
        return
      }

      // Open/attempted tasks, to compute each lead's next due task client-side
      const { data: taskRows, error: tasksError } = await insforge.database
        .from('tasks')
        .select('id,person_id,enquiry_id,type,state,due_at')
        .in('state', ['open', 'attempted'])
        .limit(500)
      if (cancelled) return
      if (tasksError) {
        setLeads({ status: 'error', error: tasksError.message })
        return
      }

      // Volunteer ids for the owner filter (user_roles join roles, filtered client-side)
      const { data: roleRows, error: rolesError } = await insforge.database
        .from('user_roles')
        .select('user_id, roles(name)')
        .limit(200)
      if (!cancelled && !rolesError) {
        setVolunteerIds(volunteerIdsFromRoleRows((roleRows ?? []) as never[]))
      }

      const tasks = (taskRows ?? []) as TaskRow[]
      const rows: LeadRow[] = ((enquiryRows ?? []) as LeadListRow[]).map((e) => {
        const next = nextOpenTask(tasks, { id: e.id, person_id: e.person_id })
        return {
          ...e,
          next_task_due_at: next?.due_at ?? null,
          next_task_open: next != null,
        }
      })
      if (!cancelled) setLeads({ status: 'done', rows })
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const allRows = leads.status === 'done' ? leads.rows : []
  const sources = useMemo(() => sourceOptions(allRows), [allRows])
  const filtered = useMemo(() => filterLeads(allRows, filters), [allRows, filters])
  const volunteers = useMemo(
    () => members.filter((m) => volunteerIds.includes(m.id)),
    [members, volunteerIds]
  )

  return (
    <div className="space-y-4">
      <Panel title="Leads" state={leads} empty="No enquiries match. New leads appear here after signup.">
        {(rows) => (
          <div>
            <fieldset className="flex flex-wrap items-end gap-3 border-b border-navy-100 px-4 py-3">
              <legend className="sr-only">Filter leads</legend>
              <div>
                <label htmlFor="filter-owner" className="block text-xs font-semibold uppercase text-navy-600">
                  Owner
                </label>
                <select
                  id="filter-owner"
                  value={filters.owner}
                  onChange={(e) => setFilters({ ...filters, owner: e.target.value })}
                  className="mt-1 rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-900"
                >
                  <option value="">All owners</option>
                  <option value={UNASSIGNED_FILTER}>Unassigned</option>
                  {volunteers.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.full_name?.trim() || v.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="filter-stage" className="block text-xs font-semibold uppercase text-navy-600">
                  Stage
                </label>
                <select
                  id="filter-stage"
                  value={filters.stage}
                  onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
                  className="mt-1 rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-900"
                >
                  <option value="">All stages</option>
                  {STAGE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="filter-source" className="block text-xs font-semibold uppercase text-navy-600">
                  Source
                </label>
                <select
                  id="filter-source"
                  value={filters.source}
                  onChange={(e) => setFilters({ ...filters, source: e.target.value })}
                  className="mt-1 rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-900"
                >
                  <option value="">All sources</option>
                  {sources.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pb-1">
                <input
                  id="filter-overdue"
                  type="checkbox"
                  checked={filters.overdueOnly}
                  onChange={(e) => setFilters({ ...filters, overdueOnly: e.target.checked })}
                  className="h-4 w-4 rounded border-navy-100"
                />
                <label htmlFor="filter-overdue" className="text-sm font-semibold text-navy-800">
                  Overdue only
                </label>
              </div>
              <p className="pb-1 text-xs text-navy-600" aria-live="polite">
                {filtered.length} of {rows.length} leads
              </p>
            </fieldset>
            <table className="min-w-full text-left text-sm text-navy-800">
              <thead>
                <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Stage</th>
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Enquired</th>
                  <th className="px-3 py-2">Next task due</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const person = toOne(row.person)
                  const chip = stageChip(row.stage)
                  const overdue = row.next_task_open && row.next_task_due_at !== null && isOverdue(row.next_task_due_at)
                  return (
                    <tr key={row.id} className="border-b border-navy-100 last:border-0 hover:bg-navy-100/40">
                      <td className="px-3 py-2">
                        <Link
                          to="/admin/leads/$id"
                          params={{ id: row.id }}
                          className="font-medium text-navy-800 underline hover:text-burgundy-700"
                        >
                          {person ? `${person.first_name} ${person.last_name ?? ''}`.trim() : 'Unknown'}
                        </Link>
                        {person && <span className="block text-xs text-navy-600">{person.email}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <span className={chip.className}>{chip.label}</span>
                      </td>
                      <td className="px-3 py-2">{ownerName(row.assigned_to, members)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(row.created_at)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {row.next_task_open && row.next_task_due_at ? (
                          <>
                            {formatTimestamp(row.next_task_due_at)}
                            {overdue && (
                              <span className="ml-2 rounded bg-burgundy-700 px-1.5 py-0.5 text-xs font-bold text-white">
                                overdue
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-navy-600">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{row.utm_source ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

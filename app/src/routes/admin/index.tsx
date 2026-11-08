import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { insforge } from '../../lib/insforge'
import { formatTimestamp } from '../../lib/format'
import { isOverdue, ownerName, stageChip, toOne, notificationStatusChip } from '../../lib/admin'
import { Panel, type PanelState } from '../../components/admin-chrome'
import { useClubAuth } from '../../hooks/useClubAuth'
import type { ActionQueueRow, EnquiryRow, NotificationJobRow } from '../../lib/types'
import { Link } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/')({
  component: AdminOverviewPage,
})

// /admin overview (Sprint 1 panels kept, Sprint 2: enquiries rows link to lead detail).
// Action queue + notification jobs stay here; the leads CRM lives at /admin/leads.
function AdminOverviewPage() {
  const { members } = useClubAuth()
  const [queue, setQueue] = useState<PanelState<ActionQueueRow[]>>({ status: 'loading' })
  const [enquiries, setEnquiries] = useState<PanelState<EnquiryRow[]>>({ status: 'loading' })
  const [jobs, setJobs] = useState<PanelState<NotificationJobRow[]>>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function load() {
      setQueue({ status: 'loading' })
      setEnquiries({ status: 'loading' })
      setJobs({ status: 'loading' })

      // (a) Action queue: open/attempted/reassigned tasks, soonest due first (P0.6)
      const { data: queueRows, error: queueError } = await insforge.database
        .from('action_queue')
        .select('*')
        .order('due_at')
        .limit(50)
      if (cancelled) return
      setQueue(
        queueError
          ? { status: 'error', error: queueError.message }
          : { status: 'done', rows: (queueRows ?? []) as ActionQueueRow[] }
      )

      // (b) Enquiries: latest 50 with lead + stage + owner; rows link to /admin/leads/$id
      const { data: enquiryRows, error: enquiriesError } = await insforge.database
        .from('enquiries')
        .select('id,stage,created_at,assigned_to,utm_source,person:people(first_name,last_name,email)')
        .order('created_at', { ascending: false })
        .limit(50)
      if (cancelled) return
      setEnquiries(
        enquiriesError
          ? { status: 'error', error: enquiriesError.message }
          : { status: 'done', rows: (enquiryRows ?? []) as EnquiryRow[] }
      )

      // (c) Notification jobs: latest 50; failed/dry_run chips keep delivery
      // problems visible without losing the lead (WF-01.7)
      const { data: jobRows, error: jobsError } = await insforge.database
        .from('notification_jobs')
        .select('id,type,to_email,status,attempts,created_at,last_error')
        .order('created_at', { ascending: false })
        .limit(50)
      if (cancelled) return
      setJobs(
        jobsError
          ? { status: 'error', error: jobsError.message }
          : { status: 'done', rows: (jobRows ?? []) as NotificationJobRow[] }
      )
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-8">
      <Panel title="Action queue" state={queue}>
        {(rows) => (
          <table className="min-w-full text-left text-sm text-navy-800">
            <thead>
              <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                <th className="px-3 py-2">Task</th>
                <th className="px-3 py-2">State</th>
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Enquired</th>
                <th className="px-3 py-2">Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.task_id} className="border-b border-navy-100 last:border-0">
                  <td className="px-3 py-2 font-medium">
                    {row.task_type}
                    {(row.overdue || isOverdue(row.due_at)) && (
                      <span className="ml-2 rounded bg-burgundy-700 px-1.5 py-0.5 text-xs font-bold text-white">
                        overdue
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{row.task_state}</td>
                  <td className="px-3 py-2">
                    {row.enquiry_id ? (
                      <Link
                        to="/admin/leads/$id"
                        params={{ id: row.enquiry_id }}
                        className="font-medium text-navy-800 underline hover:text-burgundy-700"
                      >
                        {row.first_name} {row.last_name ?? ''}
                      </Link>
                    ) : (
                      <span className="font-medium">
                        {row.first_name} {row.last_name ?? ''}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(row.due_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(row.enquired_at)}</td>
                  <td className="px-3 py-2">{ownerName(row.owner_id, members)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Enquiries"
        state={enquiries}
        empty="No enquiries yet. Open the Leads tab for filters and full lead profiles."
      >
        {(rows) => (
          <table className="min-w-full text-left text-sm text-navy-800">
            <thead>
              <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                <th className="px-3 py-2">Prospect</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Enquired</th>
                <th className="px-3 py-2">Owner</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const person = toOne(row.person)
                const chip = stageChip(row.stage)
                return (
                  <tr key={row.id} className="border-b border-navy-100 last:border-0">
                    <td className="px-3 py-2">
                      {person ? (
                        <Link
                          to="/admin/leads/$id"
                          params={{ id: row.id }}
                          className="hover:text-burgundy-700"
                        >
                          <span className="font-medium underline">
                            {person.first_name} {person.last_name ?? ''}
                          </span>
                          <span className="block text-xs text-navy-600">{person.email}</span>
                        </Link>
                      ) : (
                        <span className="text-navy-600">Unknown</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={chip.className}>{chip.label}</span>
                    </td>
                    <td className="px-3 py-2">{row.utm_source ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(row.created_at)}</td>
                    <td className="px-3 py-2">{ownerName(row.assigned_to, members)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Notification jobs" state={jobs}>
        {(rows) => (
          <table className="min-w-full text-left text-sm text-navy-800">
            <thead>
              <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Last error</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const chip = notificationStatusChip(row.status)
                return (
                  <tr key={row.id} className="border-b border-navy-100 last:border-0">
                    <td className="px-3 py-2 font-medium">{row.type}</td>
                    <td className="px-3 py-2">{row.to_email}</td>
                    <td className="px-3 py-2">
                      <span className={chip.className}>{chip.label}</span>
                    </td>
                    <td className="px-3 py-2">{row.attempts}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(row.created_at)}</td>
                    <td className="px-3 py-2 max-w-52 truncate text-burgundy-700" title={row.last_error ?? ''}>
                      {row.last_error ?? '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}

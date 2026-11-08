import { useCallback, useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { insforge } from '../../lib/insforge'
import { toOne } from '../../lib/admin'
import type { PanelState } from '../../components/admin-chrome'
import {
  InteractionForm,
  MilestoneForm,
  PersonCard,
  ReassignControl,
  StageEditor,
  TasksPanel,
  Timeline,
} from '../../components/lead-detail'
import { useClubAuth } from '../../hooks/useClubAuth'
import { canReadMilestones, volunteerIdsFromRoleRows } from '../../lib/crm'
import type {
  AuditEventRow,
  ClubMember,
  EnquiryDetailRow,
  InteractionRow,
  MilestoneRow,
  TaskRow,
} from '../../lib/types'

export const Route = createFileRoute('/admin/leads/$id')({
  component: LeadDetailPage,
})

interface LeadData {
  enquiry: EnquiryDetailRow
  tasks: TaskRow[]
  interactions: InteractionRow[]
  audits: AuditEventRow[]
  milestones: MilestoneRow[]
  volunteers: ClubMember[]
}

// /admin/leads/$id — lead detail (plan P0.5): person card, stage editor, open tasks,
// reassign (coordinator/admin), log interaction, milestones, merged activity timeline.
function LeadDetailPage() {
  const { id } = Route.useParams()
  const { user, roleNames, members } = useClubAuth()
  const [data, setData] = useState<PanelState<LeadData>>({ status: 'loading' })

  const load = useCallback(async () => {
    setData({ status: 'loading' })

    // Enquiry + person embed
    const { data: enquiryRows, error: enquiryError } = await insforge.database
      .from('enquiries')
      .select('*, person:people(*)')
      .eq('id', id)
    const enquiry = (enquiryRows ?? [])[0] as EnquiryDetailRow | undefined
    if (enquiryError || !enquiry) {
      setData({ status: 'error', error: enquiryError?.message ?? 'Enquiry not found' })
      return
    }
    const person = toOne(enquiry.person)
    if (!person) {
      setData({ status: 'error', error: 'Person record not found for this enquiry' })
      return
    }
    const personId = person.id

    // Tasks for this person (covers enquiry-linked and person-level tasks)
    const { data: taskRows, error: tasksError } = await insforge.database
      .from('tasks')
      .select('*')
      .eq('person_id', personId)
      .order('due_at')
    if (tasksError) {
      setData({ status: 'error', error: tasksError.message })
      return
    }

    // Interactions for this person
    const { data: interactionRows, error: interactionsError } = await insforge.database
      .from('interactions')
      .select('*')
      .eq('person_id', personId)
      .order('created_at', { ascending: false })
      .limit(200)
    if (interactionsError) {
      setData({ status: 'error', error: interactionsError.message })
      return
    }

    // Audit trail: events whose record_id is this person or any of their enquiries.
    // audit_events is readable by all club staff (Sprint 2 migration).
    const { data: enquiryIdsRows } = await insforge.database
      .from('enquiries')
      .select('id')
      .eq('person_id', personId)
    const recordIds = [personId, ...((enquiryIdsRows ?? []).map((r) => (r as { id: string }).id))]
    const { data: auditRows, error: auditsError } = await insforge.database
      .from('audit_events')
      .select('*')
      .in('record_id', recordIds)
      .in('table_name', ['people', 'enquiries', 'tasks', 'interactions', 'milestones'])
      .order('created_at', { ascending: false })
      .limit(200)
    if (auditsError) {
      setData({ status: 'error', error: auditsError.message })
      return
    }

    // Volunteers for the reassign control (club_members × user_roles role=volunteer)
    const { data: roleRows } = await insforge.database
      .from('user_roles')
      .select('user_id, roles(name)')
      .limit(200)
    const volunteerIds = volunteerIdsFromRoleRows((roleRows ?? []) as never[])
    const volunteers = members.filter((m) => volunteerIds.includes(m.id))

    // Milestones are staff-readable only for admin/coordinator/coach (RLS);
    // volunteers get an empty list instead of an error.
    let milestones: MilestoneRow[] = []
    if (canReadMilestones(roleNames)) {
      const { data: milestoneRows } = await insforge.database
        .from('milestones')
        .select('*')
        .eq('person_id', personId)
        .order('achieved_at', { ascending: false })
        .limit(100)
      milestones = (milestoneRows ?? []) as MilestoneRow[]
    }

    setData({
      status: 'done',
      rows: {
        enquiry,
        tasks: (taskRows ?? []) as TaskRow[],
        interactions: (interactionRows ?? []) as InteractionRow[],
        audits: (auditRows ?? []) as AuditEventRow[],
        milestones,
        volunteers,
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, members, roleNames.join('|')])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <p className="text-sm">
        <Link to="/admin/leads" className="font-semibold text-gold-300 hover:text-gold-400">
          ← Back to leads
        </Link>
      </p>
      {data.status === 'loading' && <p className="text-sm text-navy-100">Loading lead…</p>}
      {data.status === 'error' && (
        <div role="alert" className="rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
          Could not load lead: {data.error}
        </div>
      )}
      {data.status === 'done' && (
        <div className="space-y-4">
          <PersonCard enquiry={data.rows.enquiry} />
          <StageEditor enquiry={data.rows.enquiry} onSaved={refresh} />
          <TasksPanel tasks={data.rows.tasks} members={members} onCompleted={refresh} />
          <ReassignControl
            enquiry={data.rows.enquiry}
            roleNames={roleNames}
            volunteers={data.rows.volunteers}
            onReassigned={refresh}
          />
          <InteractionForm personId={data.rows.enquiry.person_id} enquiryId={data.rows.enquiry.id} onLogged={refresh} />
          {user && (
            <MilestoneForm
              personId={data.rows.enquiry.person_id}
              seasonId={data.rows.enquiry.season_id}
              roleNames={roleNames}
              user={user}
              onLogged={refresh}
            />
          )}
          <Timeline
            interactions={data.rows.interactions}
            audits={data.rows.audits}
            tasks={data.rows.tasks}
            milestones={data.rows.milestones}
          />
        </div>
      )}
    </div>
  )
}

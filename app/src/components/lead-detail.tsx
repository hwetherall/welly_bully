import { useState, type FormEvent } from 'react'
import { formatTimestamp } from '../lib/format'
import { isOverdue, ownerName, stageChip, toOne } from '../lib/admin'
import {
  INTERACTION_TYPE_LABELS,
  INTERACTION_TYPES,
  MILESTONE_LABELS,
  MILESTONE_TYPES,
  STAGE_OPTIONS,
  TASK_OUTCOMES,
  buildTimeline,
  canCoordinate,
  pathwayFromAnswers,
  type EnquiryStage,
  type InteractionType,
  type MilestoneType,
} from '../lib/crm'
import {
  addMilestone,
  completeTask,
  logInteraction,
  reassignEnquiry,
  setEnquiryStage,
} from '../lib/crm-api'
import type {
  AuditEventRow,
  ClubMember,
  EnquiryDetailRow,
  InteractionRow,
  MilestoneRow,
  PersonRow,
  TaskRow,
} from '../lib/types'
import type { ClubUser } from '../hooks/useClubAuth'

const inputCls = 'mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-sm text-navy-900'
const labelCls = 'block text-sm font-semibold text-navy-800'
const btnCls =
  'rounded-xl bg-navy-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-60'

interface Status {
  kind: 'ok' | 'error'
  message: string
}

function StatusLine({ status }: { status: Status | null }) {
  if (!status) return null
  return (
    <p
      role={status.kind === 'error' ? 'alert' : 'status'}
      className={`mt-2 rounded-lg p-2 text-sm font-medium ${
        status.kind === 'error' ? 'bg-burgundy-100 text-burgundy-800' : 'bg-green-100 text-green-800'
      }`}
    >
      {status.message}
    </p>
  )
}

//------------------------------------------------------------------------
// (a) Person card
//------------------------------------------------------------------------

export function PersonCard({ enquiry }: { enquiry: EnquiryDetailRow }) {
  const person = toOne(enquiry.person) as PersonRow | null
  if (!person) {
    return (
      <section className="rounded-xl bg-white p-4 shadow">
        <h2 className="text-lg font-extrabold text-navy-800">Prospect</h2>
        <p className="mt-2 text-sm text-navy-600">Person record not found.</p>
      </section>
    )
  }
  const name = [person.preferred_name ?? person.first_name, person.last_name ?? ''].join(' ').trim()
  return (
    <section className="rounded-xl bg-white p-4 shadow" aria-labelledby="lead-person-heading">
      <h2 id="lead-person-heading" className="text-lg font-extrabold text-navy-800">
        {name}
      </h2>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm text-navy-800 sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-navy-600">Email</dt>
          <dd>{person.email}</dd>
        </div>
        <div>
          <dt className="font-semibold text-navy-600">Phone</dt>
          <dd>{person.phone ?? '—'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-navy-600">Source</dt>
          <dd>{person.source ?? enquiry.utm_source ?? '—'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-navy-600">Pathway</dt>
          <dd>{pathwayFromAnswers(enquiry.answers)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-navy-600">Consent to contact</dt>
          <dd>
            {person.consent_contact ? (
              <>Yes{person.consent_at ? ` (${formatTimestamp(person.consent_at)})` : ''}</>
            ) : (
              'No'
            )}
            {person.contact_opt_out && <span className="ml-2 font-bold text-burgundy-700">opted out</span>}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-navy-600">Enquired</dt>
          <dd>{formatTimestamp(enquiry.created_at)}</dd>
        </div>
      </dl>
    </section>
  )
}

//------------------------------------------------------------------------
// (b) Stage editor → rpc set_enquiry_stage
//------------------------------------------------------------------------

export function StageEditor({
  enquiry,
  onSaved,
}: {
  enquiry: EnquiryDetailRow
  onSaved: () => void
}) {
  const [stage, setStage] = useState<EnquiryStage>(enquiry.stage as EnquiryStage)
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (stage === enquiry.stage) return
    setBusy(true)
    setStatus(null)
    const { error } = await setEnquiryStage(enquiry.id, stage)
    setBusy(false)
    if (error) {
      setStatus({ kind: 'error', message: `Could not update stage: ${error.message}` })
      return
    }
    setStatus({ kind: 'ok', message: `Stage set to ${stage.replace(/_/g, ' ')}.` })
    onSaved()
  }

  const chip = stageChip(enquiry.stage)
  return (
    <section className="rounded-xl bg-white p-4 shadow" aria-labelledby="lead-stage-heading">
      <h2 id="lead-stage-heading" className="text-lg font-extrabold text-navy-800">
        Stage <span className={chip.className}>{chip.label}</span>
      </h2>
      <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="stage-select" className={labelCls}>
            Current stage
          </label>
          <select
            id="stage-select"
            value={stage}
            onChange={(e) => setStage(e.target.value as EnquiryStage)}
            className={inputCls}
          >
            {STAGE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={busy || stage === enquiry.stage} className={btnCls}>
          {busy ? 'Saving…' : 'Update stage'}
        </button>
      </form>
      <StatusLine status={status} />
    </section>
  )
}

//------------------------------------------------------------------------
// (c) Open tasks with "Mark completed" → rpc complete_task
//------------------------------------------------------------------------

export function TasksPanel({
  tasks,
  members,
  onCompleted,
}: {
  tasks: TaskRow[]
  members: ClubMember[]
  onCompleted: () => void
}) {
  const [status, setStatus] = useState<Record<string, Status | null>>({})

  async function onComplete(task: TaskRow, outcome: string, notes: string) {
    setStatus((s) => ({ ...s, [task.id]: null }))
    const { error } = await completeTask(task.id, outcome, notes.trim() ? notes.trim() : null)
    if (error) {
      setStatus((s) => ({ ...s, [task.id]: { kind: 'error', message: error.message } }))
      return
    }
    setStatus((s) => ({ ...s, [task.id]: { kind: 'ok', message: 'Task marked completed.' } }))
    onCompleted()
  }

  const open = tasks.filter((t) => t.state === 'open' || t.state === 'attempted')
  const done = tasks.filter((t) => t.state !== 'open' && t.state !== 'attempted')

  return (
    <section className="rounded-xl bg-white p-4 shadow" aria-labelledby="lead-tasks-heading">
      <h2 id="lead-tasks-heading" className="text-lg font-extrabold text-navy-800">
        Tasks
      </h2>
      {open.length === 0 && done.length === 0 && <p className="mt-2 text-sm text-navy-600">No tasks for this lead.</p>}
      <ul className="mt-3 space-y-3">
        {open.map((task) => (
          <TaskCompleteRow
            key={task.id}
            task={task}
            members={members}
            status={status[task.id] ?? null}
            onComplete={(outcome, notes) => void onComplete(task, outcome, notes)}
          />
        ))}
      </ul>
      {done.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-navy-600">
            Completed / closed tasks ({done.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm text-navy-600">
            {done.map((t) => (
              <li key={t.id}>
                {t.type.replace(/_/g, ' ')} — {t.state}
                {t.outcome ? ` (${t.outcome})` : ''}
                {t.completed_at ? ` · ${formatTimestamp(t.completed_at)}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function TaskCompleteRow({
  task,
  members,
  status,
  onComplete,
}: {
  task: TaskRow
  members: ClubMember[]
  status: Status | null
  onComplete: (outcome: string, notes: string) => void
}) {
  const [outcome, setOutcome] = useState<string>(TASK_OUTCOMES[0])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const overdue = isOverdue(task.due_at)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    await onComplete(outcome, notes)
    setBusy(false)
  }

  return (
    <li className="rounded-lg border border-navy-100 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-navy-800">
        <span className="font-semibold">{task.type.replace(/_/g, ' ')}</span>
        <span className="text-navy-600">owner: {ownerName(task.owner_id, members)}</span>
        <span className="whitespace-nowrap text-navy-600">due {formatTimestamp(task.due_at)}</span>
        {overdue && (
          <span className="rounded bg-burgundy-700 px-1.5 py-0.5 text-xs font-bold text-white">overdue</span>
        )}
      </div>
      <form onSubmit={submit} className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor={`task-outcome-${task.id}`} className="block text-xs font-semibold text-navy-600">
            Outcome
          </label>
          <select
            id={`task-outcome-${task.id}`}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="mt-1 rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-900"
          >
            {TASK_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor={`task-notes-${task.id}`} className="block text-xs font-semibold text-navy-600">
            Notes (optional)
          </label>
          <input
            id={`task-notes-${task.id}`}
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1 w-full rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-900"
          />
        </div>
        <button type="submit" disabled={busy} className={btnCls}>
          {busy ? 'Saving…' : 'Mark completed'}
        </button>
      </form>
      <StatusLine status={status} />
    </li>
  )
}

//------------------------------------------------------------------------
// (d) Reassign — coordinator/admin only, two-step inline confirm → rpc reassign_enquiry
//------------------------------------------------------------------------

export function ReassignControl({
  enquiry,
  roleNames,
  volunteers,
  onReassigned,
}: {
  enquiry: EnquiryDetailRow
  roleNames: string[]
  volunteers: ClubMember[]
  onReassigned: () => void
}) {
  const [newOwner, setNewOwner] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  if (!canCoordinate(roleNames)) return null // volunteers never see this control

  async function doReassign() {
    if (!newOwner) return
    setBusy(true)
    setStatus(null)
    const { error } = await reassignEnquiry(enquiry.id, newOwner)
    setBusy(false)
    setConfirming(false)
    if (error) {
      setStatus({ kind: 'error', message: `Could not reassign: ${error.message}` })
      return
    }
    setStatus({ kind: 'ok', message: 'Lead reassigned; a new 48h initial-call task was created.' })
    setNewOwner('')
    onReassigned()
  }

  return (
    <section className="rounded-xl bg-white p-4 shadow" aria-labelledby="lead-reassign-heading">
      <h2 id="lead-reassign-heading" className="text-lg font-extrabold text-navy-800">
        Reassign lead
      </h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="reassign-select" className={labelCls}>
            New owner (volunteers)
          </label>
          <select
            id="reassign-select"
            value={newOwner}
            onChange={(e) => {
              setNewOwner(e.target.value)
              setConfirming(false)
            }}
            className={inputCls}
          >
            <option value="">Choose a volunteer…</option>
            {volunteers.map((v) => (
              <option key={v.id} value={v.id} disabled={v.id === enquiry.assigned_to}>
                {v.full_name?.trim() || v.email}
                {v.id === enquiry.assigned_to ? ' (current owner)' : ''}
              </option>
            ))}
          </select>
        </div>
        {confirming ? (
          <>
            <button
              type="button"
              disabled={busy || !newOwner}
              onClick={() => void doReassign()}
              className="rounded-xl bg-burgundy-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              {busy ? 'Reassigning…' : 'Confirm reassign'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-xl border border-navy-100 px-4 py-2 text-sm font-bold text-navy-800"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={!newOwner}
            onClick={() => setConfirming(true)}
            className={btnCls}
          >
            Reassign…
          </button>
        )}
      </div>
      <p className="mt-2 text-xs text-navy-600">
        Reassigning closes the open tasks and creates a new 48-hour initial-call task for the new owner.
      </p>
      <StatusLine status={status} />
    </section>
  )
}

//------------------------------------------------------------------------
// (e) Log interaction form → rpc log_interaction
//------------------------------------------------------------------------

export function InteractionForm({
  personId,
  enquiryId,
  onLogged,
}: {
  personId: string
  enquiryId: string
  onLogged: () => void
}) {
  const [type, setType] = useState<InteractionType>('call')
  const [outcome, setOutcome] = useState('')
  const [summary, setSummary] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [nextActionDue, setNextActionDue] = useState('')
  const [stage, setStage] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!summary.trim()) {
      setStatus({ kind: 'error', message: 'Summary is required.' })
      return
    }
    setBusy(true)
    setStatus(null)
    const { error } = await logInteraction({
      personId,
      enquiryId,
      type,
      outcome: outcome.trim() ? outcome.trim() : null,
      summary: summary.trim(),
      nextAction: nextAction.trim() ? nextAction.trim() : null,
      nextActionDue: nextActionDue ? new Date(nextActionDue).toISOString() : null,
      stage: stage ? (stage as EnquiryStage) : null,
    })
    setBusy(false)
    if (error) {
      setStatus({ kind: 'error', message: `Could not log interaction: ${error.message}` })
      return
    }
    setStatus({ kind: 'ok', message: 'Interaction logged.' })
    setSummary('')
    setNextAction('')
    setNextActionDue('')
    setStage('')
    setOutcome('')
    onLogged()
  }

  return (
    <section className="rounded-xl bg-white p-4 shadow" aria-labelledby="lead-interaction-heading">
      <h2 id="lead-interaction-heading" className="text-lg font-extrabold text-navy-800">
        Log interaction
      </h2>
      <form onSubmit={onSubmit} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="int-type" className={labelCls}>
            Type
          </label>
          <select id="int-type" value={type} onChange={(e) => setType(e.target.value as InteractionType)} className={inputCls}>
            {INTERACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {INTERACTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="int-outcome" className={labelCls}>
            Outcome (e.g. reached, no answer)
          </label>
          <input
            id="int-outcome"
            type="text"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className={inputCls}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="int-summary" className={labelCls}>
            Summary <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="int-summary"
            required
            rows={3}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="int-next" className={labelCls}>
            Next action
          </label>
          <input
            id="int-next"
            type="text"
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="int-next-due" className={labelCls}>
            Next action due
          </label>
          <input
            id="int-next-due"
            type="datetime-local"
            value={nextActionDue}
            onChange={(e) => setNextActionDue(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="int-stage" className={labelCls}>
            Also set stage (optional)
          </label>
          <select id="int-stage" value={stage} onChange={(e) => setStage(e.target.value)} className={inputCls}>
            <option value="">— no stage change —</option>
            {STAGE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button type="submit" disabled={busy} className={btnCls}>
            {busy ? 'Logging…' : 'Log interaction'}
          </button>
        </div>
      </form>
      <StatusLine status={status} />
    </section>
  )
}

//------------------------------------------------------------------------
// (g) Milestone quick-log — coordinator/admin only, direct insert into milestones
//------------------------------------------------------------------------

export function MilestoneForm({
  personId,
  seasonId,
  roleNames,
  user,
  onLogged,
}: {
  personId: string
  seasonId: string
  roleNames: string[]
  user: ClubUser
  onLogged: () => void
}) {
  const [type, setType] = useState<MilestoneType>('whatsapp_invited')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)

  if (!canCoordinate(roleNames)) return null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setStatus(null)
    const { error } = await addMilestone({
      person_id: personId,
      season_id: seasonId,
      type,
      recorded_by: user.id,
      notes: notes.trim() ? notes.trim() : null,
    })
    setBusy(false)
    if (error) {
      setStatus({ kind: 'error', message: `Could not save milestone: ${error.message}` })
      return
    }
    setStatus({ kind: 'ok', message: 'Milestone recorded.' })
    setNotes('')
    onLogged()
  }

  return (
    <section className="rounded-xl bg-white p-4 shadow" aria-labelledby="lead-milestone-heading">
      <h2 id="lead-milestone-heading" className="text-lg font-extrabold text-navy-800">
        Log milestone
      </h2>
      <form onSubmit={onSubmit} className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="milestone-type" className={labelCls}>
            Milestone
          </label>
          <select
            id="milestone-type"
            value={type}
            onChange={(e) => setType(e.target.value as MilestoneType)}
            className={inputCls}
          >
            {MILESTONE_TYPES.map((m) => (
              <option key={m} value={m}>
                {MILESTONE_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label htmlFor="milestone-notes" className={labelCls}>
            Notes (optional)
          </label>
          <input
            id="milestone-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputCls}
          />
        </div>
        <button type="submit" disabled={busy} className={btnCls}>
          {busy ? 'Saving…' : 'Add milestone'}
        </button>
      </form>
      <StatusLine status={status} />
    </section>
  )
}

//------------------------------------------------------------------------
// (f) Activity timeline: interactions + audit_events + tasks + milestones
//------------------------------------------------------------------------

export function Timeline({
  interactions,
  audits,
  tasks,
  milestones,
}: {
  interactions: InteractionRow[]
  audits: AuditEventRow[]
  tasks: TaskRow[]
  milestones: MilestoneRow[]
}) {
  const items = buildTimeline({ interactions, audits, tasks, milestones })
  return (
    <section className="rounded-xl bg-white p-4 shadow" aria-labelledby="lead-timeline-heading">
      <h2 id="lead-timeline-heading" className="text-lg font-extrabold text-navy-800">
        Activity
      </h2>
      {items.length === 0 && <p className="mt-2 text-sm text-navy-600">No activity recorded yet.</p>}
      <ol className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item.id} className="border-l-2 border-navy-100 pl-3">
            <p className="text-sm font-semibold text-navy-800">{item.label}</p>
            {item.detail && <p className="text-sm text-navy-600">{item.detail}</p>}
            <p className="text-xs text-navy-600">{formatTimestamp(item.at)}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

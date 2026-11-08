import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Panel, type PanelState } from '../../components/admin-chrome'
import { useClubAuth } from '../../hooks/useClubAuth'
import { canCoordinate } from '../../lib/crm'
import {
  DEFAULT_EVENT_TIME_ZONE,
  EVENT_AUDIENCES,
  EVENT_STATUSES,
  EVENT_TYPES,
  EVENT_TYPE_LABELS,
  canEditEvents,
  datetimeLocalToIso,
  eventAudienceChip,
  eventStatusChip,
  isoToDatetimeLocal,
  materialChangeBadge,
} from '../../lib/calendar'
import { fetchAllEvents, queueEventUpdateNotice, upsertEvent, type UpsertEventInput } from '../../lib/events-api'
import { formatEventDate, formatTimestamp } from '../../lib/format'
import type { AdminEventRow, QueueNoticeResult } from '../../lib/types'

export const Route = createFileRoute('/admin/events')({
  component: AdminEventsPage,
})

//------------------------------------------------------------------------
// Event form state (datetime-local wall values; converted to ISO on save)
//------------------------------------------------------------------------

interface EventFormState {
  id: string | null
  type: string
  title: string
  venue: string
  venue_url: string
  startsLocal: string
  endsLocal: string
  timeZone: string
  description: string
  status: string
  audience: string
  changeNote: string
}

function blankForm(): EventFormState {
  return {
    id: null,
    type: 'training',
    title: '',
    venue: '',
    venue_url: '',
    startsLocal: '',
    endsLocal: '',
    timeZone: DEFAULT_EVENT_TIME_ZONE,
    description: '',
    status: 'draft',
    audience: 'public',
    changeNote: '',
  }
}

function formFromEvent(ev: AdminEventRow): EventFormState {
  const tz = ev.time_zone || DEFAULT_EVENT_TIME_ZONE
  return {
    id: ev.id,
    type: ev.type,
    title: ev.title,
    venue: ev.venue ?? '',
    venue_url: ev.venue_url ?? '',
    startsLocal: isoToDatetimeLocal(ev.starts_at, tz),
    endsLocal: isoToDatetimeLocal(ev.ends_at, tz),
    timeZone: tz,
    description: ev.description ?? '',
    status: ev.status,
    audience: ev.audience,
    changeNote: ev.change_note ?? '',
  }
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; error: string }
  | { kind: 'done'; revision: number; materialChange: boolean }

type NoticeState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; error: string }
  | { kind: 'done'; result: QueueNoticeResult }

// /admin/events — calendar editor (plan P1.1): full event table, create/edit via the
// upsert_event RPC (revision + material_change handled server-side), and the WF-04
// change-notice queue for coordinators (queue_event_update_notice).
function AdminEventsPage() {
  const { roleNames } = useClubAuth()
  const canEdit = canEditEvents(roleNames)
  const canCoord = canCoordinate(roleNames)

  const [events, setEvents] = useState<PanelState<AdminEventRow[]>>({ status: 'loading' })
  const [form, setForm] = useState<EventFormState | null>(null)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [noticeByEvent, setNoticeByEvent] = useState<Record<string, NoticeState>>({})
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setEvents({ status: 'loading' })
    const { data, error } = await fetchAllEvents()
    setEvents(error ? { status: 'error', error: error.message } : { status: 'done', rows: data })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const materialChangeEvents = useMemo(
    () => (events.status === 'done' ? events.rows.filter((e) => e.material_change) : []),
    [events]
  )

  function patchForm(patch: Partial<EventFormState>) {
    setForm((f) => (f ? { ...f, ...patch } : f))
    setSave({ kind: 'idle' })
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    const startsIso = datetimeLocalToIso(form.startsLocal, form.timeZone)
    const endsIso = datetimeLocalToIso(form.endsLocal, form.timeZone)
    if (!form.title.trim()) {
      setSave({ kind: 'error', error: 'Title is required.' })
      return
    }
    if (!startsIso || !endsIso) {
      setSave({ kind: 'error', error: `Enter a valid start and end date/time (wall time in ${form.timeZone}).` })
      return
    }
    if (new Date(endsIso).getTime() < new Date(startsIso).getTime()) {
      setSave({ kind: 'error', error: 'End must be at or after the start.' })
      return
    }
    const input: UpsertEventInput = {
      id: form.id,
      type: form.type,
      title: form.title.trim(),
      venue: form.venue.trim() || null,
      venue_url: form.venue_url.trim() || null,
      starts_at: startsIso,
      ends_at: endsIso,
      time_zone: form.timeZone || DEFAULT_EVENT_TIME_ZONE,
      description: form.description.trim() || null,
      status: form.status,
      audience: form.audience,
      change_note: form.changeNote.trim() || null,
    }
    setSave({ kind: 'busy' })
    const { data, error } = await upsertEvent(input)
    if (error || !data) {
      setSave({ kind: 'error', error: error?.message ?? 'Could not save the event.' })
      return
    }
    setSave({ kind: 'done', revision: data.revision, materialChange: data.material_change })
    setBanner({
      kind: 'success',
      text: data.id === form.id && form.id
        ? `Saved “${data.title}” — revision ${data.revision}${data.material_change ? ', flagged as a material change (public banner + .ics sequence updated)' : ''}.`
        : `Created “${data.title}” (${data.status}/${data.audience}) — uid ${data.uid}.`,
    })
    setForm(null)
    await load()
  }

  async function onQueueNotice(eventId: string) {
    setNoticeByEvent((prev) => ({ ...prev, [eventId]: { kind: 'busy' } }))
    const { data, error } = await queueEventUpdateNotice(eventId)
    if (error || !data) {
      setNoticeByEvent((prev) => ({ ...prev, [eventId]: { kind: 'error', error: error?.message ?? 'Could not queue notices.' } }))
      return
    }
    setNoticeByEvent((prev) => ({ ...prev, [eventId]: { kind: 'done', result: data } }))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold text-white">Events</h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => { setForm(blankForm()); setSave({ kind: 'idle' }) }}
            className="rounded-xl bg-gold-500 px-4 py-2 text-sm font-bold text-navy-950 hover:bg-gold-400"
          >
            New event
          </button>
        )}
      </div>

      {!canEdit && (
        <p className="rounded-xl bg-navy-800 p-3 text-sm text-navy-100">
          You can view the calendar; only calendar editors and admins can create or edit events.
        </p>
      )}

      {banner && (
        <div
          role="status"
          className={`rounded-lg p-3 text-sm font-medium ${
            banner.kind === 'success' ? 'bg-green-100 text-green-800' : 'bg-burgundy-100 text-burgundy-800'
          }`}
        >
          {banner.text}{' '}
          <button type="button" onClick={() => setBanner(null)} className="ml-1 underline" aria-label="Dismiss message">
            dismiss
          </button>
        </div>
      )}

      {form && canEdit && (
        <form onSubmit={onSave} className="space-y-3 rounded-xl bg-white p-4 shadow" aria-label="Event form">
          <h3 className="text-base font-extrabold text-navy-800">
            {form.id ? 'Edit event' : 'New event'}
            {form.id && form.status === 'published' && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">
                published — time/venue/cancellation edits are flagged as material changes
              </span>
            )}
          </h3>
          {save.kind === 'error' && (
            <div role="alert" className="rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
              {save.error}
            </div>
          )}
          {save.kind === 'done' && (
            <div role="status" className="rounded-lg bg-green-100 p-3 text-sm font-medium text-green-800">
              Saved — revision {save.revision}
              {save.materialChange ? ', material change flagged' : ''}.
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ev-type" className="block text-sm font-semibold text-navy-800">Type</label>
              <select
                id="ev-type"
                value={form.type}
                onChange={(e) => patchForm({ type: e.target.value })}
                className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ev-title" className="block text-sm font-semibold text-navy-800">Title</label>
              <input
                id="ev-title"
                type="text"
                required
                value={form.title}
                onChange={(e) => patchForm({ title: e.target.value })}
                className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
              />
            </div>
            <div>
              <label htmlFor="ev-venue" className="block text-sm font-semibold text-navy-800">Venue</label>
              <input
                id="ev-venue"
                type="text"
                value={form.venue}
                onChange={(e) => patchForm({ venue: e.target.value })}
                className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
              />
            </div>
            <div>
              <label htmlFor="ev-venue-url" className="block text-sm font-semibold text-navy-800">Venue map URL</label>
              <input
                id="ev-venue-url"
                type="url"
                value={form.venue_url}
                onChange={(e) => patchForm({ venue_url: e.target.value })}
                className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
              />
            </div>
            <div>
              <label htmlFor="ev-starts" className="block text-sm font-semibold text-navy-800">
                Starts ({form.timeZone})
              </label>
              <input
                id="ev-starts"
                type="datetime-local"
                required
                value={form.startsLocal}
                onChange={(e) => patchForm({ startsLocal: e.target.value })}
                className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
              />
            </div>
            <div>
              <label htmlFor="ev-ends" className="block text-sm font-semibold text-navy-800">
                Ends ({form.timeZone})
              </label>
              <input
                id="ev-ends"
                type="datetime-local"
                required
                value={form.endsLocal}
                onChange={(e) => patchForm({ endsLocal: e.target.value })}
                className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
              />
            </div>
            <div>
              <label htmlFor="ev-status" className="block text-sm font-semibold text-navy-800">Status</label>
              <select
                id="ev-status"
                value={form.status}
                onChange={(e) => patchForm({ status: e.target.value })}
                className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
              >
                {EVENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ev-audience" className="block text-sm font-semibold text-navy-800">Audience</label>
              <select
                id="ev-audience"
                value={form.audience}
                onChange={(e) => patchForm({ audience: e.target.value })}
                className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
              >
                {EVENT_AUDIENCES.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="ev-description" className="block text-sm font-semibold text-navy-800">Description</label>
            <textarea
              id="ev-description"
              rows={3}
              value={form.description}
              onChange={(e) => patchForm({ description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
            />
          </div>
          {(form.id === null || form.status === 'published') && (
            <div>
              <label htmlFor="ev-change-note" className="block text-sm font-semibold text-navy-800">
                Change note {form.id && form.status === 'published' ? '(shown on the public change banner)' : '(optional)'}
              </label>
              <input
                id="ev-change-note"
                type="text"
                value={form.changeNote}
                onChange={(e) => patchForm({ changeNote: e.target.value })}
                placeholder="e.g. Moved to the back field — gate 2"
                className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={save.kind === 'busy'}
              className="rounded-xl bg-navy-800 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              {save.kind === 'busy' ? 'Saving…' : form.id ? 'Save changes' : 'Create event'}
            </button>
            <button
              type="button"
              onClick={() => { setForm(null); setSave({ kind: 'idle' }) }}
              className="rounded-xl border border-navy-100 px-5 py-2.5 text-sm font-semibold text-navy-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <Panel
        title="All events"
        state={events}
        empty="No events yet. Create the first one with “New event”."
      >
        {(rows) => (
          <table className="min-w-full text-left text-sm text-navy-800">
            <thead>
              <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Audience</th>
                <th className="px-3 py-2">Starts</th>
                <th className="px-3 py-2">Venue</th>
                <th className="px-3 py-2">Rev</th>
                <th className="px-3 py-2">Updated</th>
                {canEdit && <th className="px-3 py-2">Action</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((ev) => {
                const badge = materialChangeBadge(ev.material_change)
                return (
                  <tr key={ev.id} className="border-b border-navy-100 last:border-0 align-top hover:bg-navy-100/40">
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {EVENT_TYPE_LABELS[ev.type as keyof typeof EVENT_TYPE_LABELS] ?? ev.type} — {ev.title}
                      </div>
                      {badge && <span className={badge.className}>{badge.label}</span>}
                      {ev.change_note && <div className="mt-1 text-xs text-navy-600">“{ev.change_note}”</div>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={eventStatusChip(ev.status).className}>{eventStatusChip(ev.status).label}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={eventAudienceChip(ev.audience).className}>{eventAudienceChip(ev.audience).label}</span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatEventDate(ev.starts_at, ev.time_zone || DEFAULT_EVENT_TIME_ZONE)}</td>
                    <td className="px-3 py-2">{ev.venue ?? '—'}</td>
                    <td className="px-3 py-2">{ev.revision}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-navy-600">{formatTimestamp(ev.updated_at)}</td>
                    {canEdit && (
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => { setForm(formFromEvent(ev)); setSave({ kind: 'idle' }); }}
                          className="rounded-lg bg-navy-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-navy-700"
                        >
                          Edit
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Change notices"
        state={{ status: 'done', rows: materialChangeEvents }}
        empty="No material changes flagged yet. Editing the time, venue or cancelling a published event flags it here (WF-04)."
      >
        {(rows) => (
          <div>
            <p className="border-b border-navy-100 px-4 py-3 text-sm text-navy-600">
              Material-change events. “Queue update notice” enqueues an <strong>operational notice</strong> for
              consented participants only (WF-04 step 4); delivery goes through the notification queue and stays a{' '}
              <strong>dry-run until approved</strong> — nothing is sent automatically.
              {!canCoord && ' Only coordinators and admins can queue notices.'}
            </p>
            <table className="min-w-full text-left text-sm text-navy-800">
              <thead>
                <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Change note</th>
                  <th className="px-3 py-2">Rev</th>
                  <th className="px-3 py-2">Updated</th>
                  {canCoord && <th className="px-3 py-2">Action</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((ev) => {
                  const notice = noticeByEvent[ev.id] ?? { kind: 'idle' } as NoticeState
                  return (
                    <tr key={ev.id} className="border-b border-navy-100 last:border-0 align-top hover:bg-navy-100/40">
                      <td className="px-3 py-2 font-medium">{ev.title}</td>
                      <td className="px-3 py-2 text-xs">{ev.change_note ?? '—'}</td>
                      <td className="px-3 py-2">{ev.revision}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-navy-600">{formatTimestamp(ev.updated_at)}</td>
                      {canCoord && (
                        <td className="px-3 py-2">
                          {notice.kind === 'idle' && (
                            <button
                              type="button"
                              onClick={() => void onQueueNotice(ev.id)}
                              className="rounded-lg bg-burgundy-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-burgundy-600"
                            >
                              Queue update notice
                            </button>
                          )}
                          {notice.kind === 'busy' && <span className="text-xs text-navy-600">Queuing…</span>}
                          {notice.kind === 'done' && (
                            <span role="status" className="text-xs font-semibold text-green-800">
                              {notice.result.notices_queued} notice{notice.result.notices_queued === 1 ? '' : 's'} queued
                              (rev {notice.result.revision}) — via notification queue, dry-run until approved
                            </span>
                          )}
                          {notice.kind === 'error' && (
                            <span role="alert" className="text-xs font-medium text-burgundy-700">
                              {notice.error}
                            </span>
                          )}
                        </td>
                      )}
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

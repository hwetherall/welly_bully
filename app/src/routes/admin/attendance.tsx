import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Panel, type PanelState } from '../../components/admin-chrome'
import { useClubAuth } from '../../hooks/useClubAuth'
import { toOne } from '../../lib/admin'
import {
  DEFAULT_EVENT_TIME_ZONE,
  canMarkAttendance,
  derivedMilestoneLabel,
  filterPeopleByQuery,
  personDisplayName,
} from '../../lib/calendar'
import { fetchAllEvents, fetchAttendance, fetchPeople, markAttendance } from '../../lib/events-api'
import { formatEventDate, formatEventTimeRange, formatTimestamp } from '../../lib/format'
import type { AdminEventRow, AttendanceRow, MarkAttendanceResult, PersonSearchRow } from '../../lib/types'

export const Route = createFileRoute('/admin/attendance')({
  component: AdminAttendancePage,
})

type MarkState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'error'; error: string }
  | { kind: 'done'; result: MarkAttendanceResult; personName: string }

const CHIP = 'inline-block rounded px-1.5 py-0.5 text-xs font-bold whitespace-nowrap'

// /admin/attendance — volunteer/coach attendance capture (plan P1.4): pick an event,
// see who is marked, search people and mark attendance (walk-in + consent) via the
// mark_attendance RPC, which derives first/second_training milestones server-side.
function AdminAttendancePage() {
  const { roleNames } = useClubAuth()
  const canMark = canMarkAttendance(roleNames)

  const [events, setEvents] = useState<PanelState<AdminEventRow[]>>({ status: 'loading' })
  const [people, setPeople] = useState<PanelState<PersonSearchRow[]>>({ status: 'loading' })
  const [attendance, setAttendance] = useState<PanelState<AttendanceRow[]>>({ status: 'loading' })
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [pendingPersonId, setPendingPersonId] = useState<string | null>(null)
  const [walkIn, setWalkIn] = useState(false)
  const [consent, setConsent] = useState(false)
  const [mark, setMark] = useState<MarkState>({ kind: 'idle' })

  const loadEvents = useCallback(async () => {
    setEvents({ status: 'loading' })
    const [evRes, peopleRes] = await Promise.all([fetchAllEvents(), fetchPeople()])
    setEvents(evRes.error ? { status: 'error', error: evRes.error.message } : { status: 'done', rows: evRes.data })
    setPeople(peopleRes.error ? { status: 'error', error: peopleRes.error.message } : { status: 'done', rows: peopleRes.data })
  }, [])

  useEffect(() => {
    void loadEvents()
  }, [loadEvents])

  // Default selection: soonest upcoming published event, else the soonest event overall.
  useEffect(() => {
    if (selectedEventId || events.status !== 'done') return
    const now = new Date().toISOString()
    const upcoming = events.rows.filter((e) => e.status === 'published' && e.starts_at >= now)
    const pool = upcoming.length > 0 ? upcoming : events.rows
    if (pool.length > 0) setSelectedEventId(pool[0].id)
  }, [events, selectedEventId])

  const loadAttendance = useCallback(async () => {
    if (!selectedEventId) {
      setAttendance({ status: 'done', rows: [] })
      return
    }
    setAttendance({ status: 'loading' })
    const { data, error } = await fetchAttendance(selectedEventId)
    setAttendance(error ? { status: 'error', error: error.message } : { status: 'done', rows: data })
  }, [selectedEventId])

  useEffect(() => {
    void loadAttendance()
  }, [loadAttendance])

  const selectedEvent = useMemo(
    () => (events.status === 'done' ? events.rows.find((e) => e.id === selectedEventId) ?? null : null),
    [events, selectedEventId]
  )

  const attendedPersonIds = useMemo(
    () => new Set((attendance.status === 'done' ? attendance.rows : []).map((a) => a.person_id)),
    [attendance]
  )

  const filteredPeople = useMemo(
    () => (people.status === 'done' ? filterPeopleByQuery(people.rows, query, 20) : []),
    [people, query]
  )

  async function onMark() {
    if (!selectedEventId || !pendingPersonId) return
    setMark({ kind: 'busy' })
    const person = people.status === 'done' ? people.rows.find((p) => p.id === pendingPersonId) : null
    const { data, error } = await markAttendance(selectedEventId, pendingPersonId, walkIn, consent)
    if (error || !data) {
      setMark({ kind: 'error', error: error?.message ?? 'Could not record attendance.' })
      return
    }
    setMark({ kind: 'done', result: data, personName: person ? personDisplayName(person) : 'Person' })
    setPendingPersonId(null)
    setWalkIn(false)
    setConsent(false)
    await loadAttendance()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full sm:w-96">
          <label htmlFor="attendance-event" className="block text-sm font-semibold text-white">
            Event
          </label>
          {events.status === 'loading' && <p className="mt-1 text-sm text-navy-100">Loading events…</p>}
          {events.status === 'error' && (
            <div role="alert" className="mt-1 rounded-lg bg-burgundy-100 p-2 text-sm font-medium text-burgundy-800">
              Could not load events: {events.error}
            </div>
          )}
          {events.status === 'done' && (
            <select
              id="attendance-event"
              value={selectedEventId ?? ''}
              onChange={(e) => { setSelectedEventId(e.target.value || null); setMark({ kind: 'idle' }) }}
              className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
            >
              {events.rows.length === 0 && <option value="">No events yet</option>}
              {events.rows.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title} — {formatEventDate(ev.starts_at, ev.time_zone || DEFAULT_EVENT_TIME_ZONE)} ({ev.status})
                </option>
              ))}
            </select>
          )}
        </div>
        {selectedEvent && (
          <p className="text-sm text-navy-100">
            {formatEventTimeRange(selectedEvent.starts_at, selectedEvent.ends_at, selectedEvent.time_zone || DEFAULT_EVENT_TIME_ZONE)}
            {selectedEvent.venue ? ` · ${selectedEvent.venue}` : ''}
          </p>
        )}
      </div>

      {!canMark && (
        <p className="rounded-xl bg-navy-800 p-3 text-sm text-navy-100">
          You can view attendance; coaches, coordinators and admins can mark attendance.
        </p>
      )}

      {mark.kind === 'done' && (
        <div role="status" className="rounded-lg bg-green-100 p-3 text-sm font-medium text-green-800">
          Marked <strong>{mark.personName}</strong> as attended
          {mark.result.milestones_derived.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {mark.result.milestones_derived.map((m) => (
                <li key={m}>{derivedMilestoneLabel(m)}</li>
              ))}
            </ul>
          )}
          {mark.result.milestones_derived.length === 0 && (
            <span className="mt-1 block text-xs font-normal">
              Attendance #{mark.result.total_attendance_count} for this person — no new milestone derived.
            </span>
          )}{' '}
          <button type="button" onClick={() => setMark({ kind: 'idle' })} className="ml-1 underline" aria-label="Dismiss message">
            dismiss
          </button>
        </div>
      )}
      {mark.kind === 'error' && (
        <div role="alert" className="rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
          {mark.error}{' '}
          <button type="button" onClick={() => setMark({ kind: 'idle' })} className="underline">
            dismiss
          </button>
        </div>
      )}

      <Panel
        title="Attendance"
        state={attendance}
        empty={selectedEvent ? 'Nobody marked for this event yet.' : 'Select an event to see attendance.'}
      >
        {(rows) => (
          <table className="min-w-full text-left text-sm text-navy-800">
            <thead>
              <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                <th className="px-3 py-2">Person</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Badges</th>
                <th className="px-3 py-2">Checked in</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const person = toOne(a.person)
                return (
                  <tr key={a.id} className="border-b border-navy-100 last:border-0 hover:bg-navy-100/40">
                    <td className="px-3 py-2 font-medium">{person ? personDisplayName(person) : a.person_id.slice(0, 8)}</td>
                    <td className="px-3 py-2">{person?.email ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span className="space-x-1">
                        {a.walk_in && <span className={`${CHIP} bg-amber-100 text-amber-800`}>walk-in</span>}
                        {a.consent_recorded && <span className={`${CHIP} bg-green-100 text-green-800`}>consent recorded</span>}
                        {!a.walk_in && !a.consent_recorded && <span className="text-navy-600">—</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-navy-600">{formatTimestamp(a.checked_in_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>

      {canMark && (
        <section className="rounded-xl bg-white p-4 shadow">
          <h2 className="text-lg font-extrabold text-navy-800">Mark attended</h2>
          <p className="mt-1 text-sm text-navy-600">
            Search people by name or email, then mark them for {selectedEvent ? `“${selectedEvent.title}”` : 'the selected event'}.
          </p>
          <div className="mt-3">
            <label htmlFor="person-search" className="block text-sm font-semibold text-navy-800">
              Search people
            </label>
            <input
              id="person-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or email…"
              className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
            />
          </div>
          {people.status === 'loading' && <p className="mt-3 text-sm text-navy-600">Loading people…</p>}
          {people.status === 'error' && (
            <div role="alert" className="mt-3 rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
              Could not load people: {people.error}
            </div>
          )}
          {people.status === 'done' && (
            <ul className="mt-3 divide-y divide-navy-100 overflow-hidden rounded-lg border border-navy-100">
              {filteredPeople.length === 0 && (
                <li className="px-3 py-2 text-sm text-navy-600">No people match “{query}”.</li>
              )}
              {filteredPeople.map((p) => {
                const already = attendedPersonIds.has(p.id)
                const isPending = pendingPersonId === p.id
                return (
                  <li key={p.id} className="px-3 py-2 text-sm text-navy-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium">{personDisplayName(p)}</span>{' '}
                        <span className="text-xs text-navy-600">{p.email}</span>
                      </div>
                      {already ? (
                        <span className={`${CHIP} bg-green-100 text-green-800`}>attended ✓</span>
                      ) : (
                        <button
                          type="button"
                          disabled={!selectedEventId || mark.kind === 'busy'}
                          onClick={() => { setPendingPersonId(p.id); setMark({ kind: 'idle' }) }}
                          className="rounded-lg bg-navy-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-navy-700 disabled:opacity-60"
                        >
                          Mark attended
                        </button>
                      )}
                    </div>
                    {isPending && (
                      <div className="mt-2 flex flex-wrap items-center gap-4 rounded-lg bg-navy-100/60 p-2">
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-navy-800">
                          <input type="checkbox" checked={walkIn} onChange={(e) => setWalkIn(e.target.checked)} />
                          Walk-in (no prior sign-up)
                        </label>
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-navy-800">
                          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                          Consent recorded on the day
                        </label>
                        <button
                          type="button"
                          disabled={mark.kind === 'busy'}
                          onClick={() => void onMark()}
                          className="rounded-lg bg-burgundy-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-burgundy-600 disabled:opacity-60"
                        >
                          {mark.kind === 'busy' ? 'Saving…' : 'Confirm attendance'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingPersonId(null)}
                          className="text-xs font-semibold text-navy-800 underline"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

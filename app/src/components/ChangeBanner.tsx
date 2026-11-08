import { useState } from 'react'
import type { PublicEventsState } from '../hooks/usePublicEvents'
import type { PublicEventRow } from '../lib/types'
import { bannerDismissKey } from '../lib/calendar'
import { publicIcsEventUrl } from '../lib/events'
import { formatEventDate, formatEventTimeRange } from '../lib/format'

// Dismissible WF-04 change banner for the public landing page: shows the latest
// material change on a published public event (change_note + title + link) until
// the visitor dismisses it — dismissal is stored in localStorage per event id.
const DISMISSED_ID_KEY = 'bulldogs:change-banner-dismissed-id'

export function ChangeBanner({ state }: { state: PublicEventsState<PublicEventRow | null> }) {
  const [dismissedId, setDismissedId] = useState<string | null>(() => {
    try {
      return typeof window !== 'undefined' ? window.localStorage.getItem(DISMISSED_ID_KEY) : null
    } catch {
      return null
    }
  })

  if (state.status !== 'done' || !state.rows) return null
  const event = state.rows
  if (dismissedId === event.id) return null

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISSED_ID_KEY, event.id)
      window.localStorage.setItem(bannerDismissKey(event.id), new Date().toISOString())
    } catch {
      // private mode etc. — dismiss for this render only
    }
    setDismissedId(event.id)
  }

  const tz = event.time_zone || 'America/Denver'
  return (
    <div role="status" className="mb-6 rounded-xl border-2 border-gold-500 bg-navy-800 p-4 shadow">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold uppercase tracking-wide text-gold-400">Schedule update</p>
          <p className="mt-1 font-bold text-white">{event.title}</p>
          <p className="mt-1 text-sm text-navy-100">
            {formatEventDate(event.starts_at, tz)} · {formatEventTimeRange(event.starts_at, event.ends_at, tz)}
            {event.venue ? ` · ${event.venue}` : ''}
          </p>
          {event.change_note && <p className="mt-2 text-sm text-navy-100">{event.change_note}</p>}
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <a href="#upcoming-sessions" className="font-semibold text-gold-400 underline">
              See in upcoming sessions
            </a>
            <a href={publicIcsEventUrl(event.uid)} className="font-semibold text-gold-400 underline" download>
              Add to calendar (.ics)
            </a>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss schedule update"
          className="rounded-lg border border-navy-100 px-2 py-1 text-xs font-semibold text-navy-100 hover:bg-navy-700"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

import type { NextEventState } from '../hooks/useNextPublicEvent'
import { formatEventDate, formatEventTimeRange } from '../lib/format'

// "Next confirmed session" card (plan P0.1) — shared by / and /thanks.
// Renders loading / error+retry / empty / loaded states explicitly.
export function NextSessionCard({ status, event, error, reload }: NextEventState & { reload: () => void }) {
  if (status === 'loading') {
    return (
      <div className="rounded-xl bg-white p-5 text-navy-800 shadow" aria-busy="true">
        <p className="text-sm font-semibold uppercase tracking-wide text-burgundy-600">
          Next confirmed session
        </p>
        <div className="mt-3 space-y-2" aria-hidden="true">
          <div className="h-5 w-2/3 animate-pulse rounded bg-navy-100" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-navy-100" />
          <div className="h-4 w-1/3 animate-pulse rounded bg-navy-100" />
        </div>
        <p className="sr-only">Loading next session…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="rounded-xl bg-white p-5 text-navy-800 shadow" role="alert">
        <p className="text-sm font-semibold uppercase tracking-wide text-burgundy-600">
          Next confirmed session
        </p>
        <p className="mt-2 text-sm">We couldn’t load the schedule right now. {error}</p>
        <button
          type="button"
          onClick={reload}
          className="mt-3 rounded-lg bg-navy-800 px-4 py-2 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="rounded-xl bg-white p-5 text-navy-800 shadow">
        <p className="text-sm font-semibold uppercase tracking-wide text-burgundy-600">
          Next confirmed session
        </p>
        <p className="mt-2 text-sm">
          No upcoming public sessions are published yet — sign up below and a volunteer will let you
          know the next one.
        </p>
      </div>
    )
  }

  const tz = event.time_zone || 'America/Denver'
  return (
    <div className="rounded-xl bg-white p-5 text-navy-800 shadow">
      <p className="text-sm font-semibold uppercase tracking-wide text-burgundy-600">
        Next confirmed session
      </p>
      <h3 className="mt-2 text-xl font-bold">{event.title}</h3>
      <p className="mt-1 font-medium text-navy-700">{formatEventDate(event.starts_at, tz)}</p>
      <p className="text-sm text-navy-700">{formatEventTimeRange(event.starts_at, event.ends_at, tz)}</p>
      {event.venue && <p className="mt-1 text-sm">📍 {event.venue}</p>}
      {event.description && <p className="mt-2 text-sm">{event.description}</p>}
      {event.venue_url && (
        <a
          href={event.venue_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block rounded-lg bg-burgundy-700 px-4 py-2 text-sm font-semibold text-white"
        >
          Open in maps
        </a>
      )}
    </div>
  )
}

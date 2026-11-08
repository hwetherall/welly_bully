import { Link, createFileRoute } from '@tanstack/react-router'
import { ChangeBanner } from '../components/ChangeBanner'
import { NextSessionCard } from '../components/NextSessionCard'
import { useChangeBannerEvent, useUpcomingPublicEvents } from '../hooks/usePublicEvents'
import { useNextPublicEvent } from '../hooks/useNextPublicEvent'
import { publicIcsEventUrl, publicIcsFeedUrl } from '../lib/events'
import { formatEventDate, formatEventTimeRange } from '../lib/format'
import { EVENT_TYPE_LABELS, type EventType } from '../lib/calendar'

export const Route = createFileRoute('/')({
  component: LandingPage,
})

// Recruitment landing page (plan P0.1 + Sprint 4 P1.1/P1.3). Mobile-first; no
// hard-coded training times — the calendar comes from the published events table.
function LandingPage() {
  const next = useNextPublicEvent()
  const banner = useChangeBannerEvent()
  const upcoming = useUpcomingPublicEvents(8)

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* WF-04: prominent change notice for material changes to published public events */}
      <ChangeBanner state={banner} />

      {/* Hero */}
      <section className="py-8 text-center">
        <h1 className="text-3xl font-extrabold leading-tight text-white sm:text-4xl">
          No Australian football experience needed —{' '}
          <span className="text-gold-400">come try footy</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-navy-100">
          The Denver Bulldogs are a volunteer-run Aussie rules club. Whether you’ve never held a
          footy or played for years, there’s a spot for you. Turn up, have a kick, and see if it’s
          for you.
        </p>
        <Link
          to="/signup"
          className="mt-6 inline-block rounded-xl bg-gold-500 px-8 py-3 text-base font-bold text-navy-950 shadow hover:bg-gold-400"
        >
          Come try footy — sign up
        </Link>
      </section>

      {/* Next confirmed session (live from the calendar, not hard-coded) */}
      <section id="next-session" className="py-6">
        <NextSessionCard {...next} />
      </section>

      {/* Upcoming sessions (plan P1.1) + .ics subscribe (plan P1.2) */}
      <section id="upcoming-sessions" className="py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold text-white">Upcoming sessions</h2>
          <a
            href={publicIcsFeedUrl()}
            className="text-sm font-semibold text-gold-400 underline"
            title="Subscribe in Google Calendar, Outlook or Apple Calendar — refreshes can take hours (subscriptions are eventually consistent)"
          >
            Subscribe to calendar (.ics)
          </a>
        </div>
        {upcoming.status === 'loading' && (
          <div className="mt-3 space-y-2 rounded-xl bg-navy-800 p-4" aria-busy="true">
            <div className="h-4 w-2/3 animate-pulse rounded bg-navy-700" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-navy-700" />
          </div>
        )}
        {upcoming.status === 'error' && (
          <div role="alert" className="mt-3 rounded-xl bg-navy-800 p-4 text-sm text-navy-100">
            Couldn’t load the full schedule right now. {upcoming.error}{' '}
            <button type="button" onClick={upcoming.reload} className="underline">
              Try again
            </button>
          </div>
        )}
        {upcoming.status === 'done' && upcoming.rows.length === 0 && (
          <p className="mt-3 text-navy-100">More sessions will be published soon — sign up and we’ll keep you posted.</p>
        )}
        {upcoming.status === 'done' && upcoming.rows.length > 0 && (
          <ul className="mt-3 space-y-3">
            {upcoming.rows.map((ev) => {
              const tz = ev.time_zone || 'America/Denver'
              return (
                <li key={ev.id} className="rounded-xl bg-navy-800 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-bold text-white">
                      <span className="mr-2 rounded bg-navy-700 px-1.5 py-0.5 text-xs font-bold text-gold-400">
                        {EVENT_TYPE_LABELS[ev.type as EventType] ?? ev.type}
                      </span>
                      {ev.title}
                    </h3>
                    <a
                      href={publicIcsEventUrl(ev.uid)}
                      download
                      className="text-sm font-semibold text-gold-400 underline"
                      title="Download an .ics file to add this session to your calendar"
                    >
                      Add to calendar
                    </a>
                  </div>
                  <p className="mt-1 text-sm font-medium text-navy-100">{formatEventDate(ev.starts_at, tz)}</p>
                  <p className="text-sm text-navy-100">{formatEventTimeRange(ev.starts_at, ev.ends_at, tz)}</p>
                  {ev.venue && (
                    <p className="mt-1 text-sm text-navy-100">
                      📍{' '}
                      {ev.venue_url ? (
                        <a href={ev.venue_url} target="_blank" rel="noopener noreferrer" className="underline">
                          {ev.venue}
                        </a>
                      ) : (
                        ev.venue
                      )}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* What to bring */}
      <section className="py-6">
        <h2 className="text-xl font-bold text-white">What to bring</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-navy-100">
          <li>Boots (soccer/rugby boots are ideal) or grippy runners if you don’t have them yet</li>
          <li>A water bottle</li>
          <li>Comfortable clothes you can move in</li>
          <li>That’s it — we bring the footy, and a spare jersey if you need one</li>
        </ul>
      </section>

      {/* Club culture */}
      <section className="py-6">
        <h2 className="text-xl font-bold text-white">The club</h2>
        <p className="mt-3 text-navy-100">
          We’re a community club run by volunteers — mates who love the game and love welcoming new
          people. Training is about learning, fitness and having a laugh, not tryouts. After the
          siren we usually grab a drink together; bring your questions, we’ll bring the answers.
        </p>
      </section>

      {/* Pathways */}
      <section className="py-6">
        <h2 className="text-xl font-bold text-white">Find your pathway</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-navy-800 p-4">
            <h3 className="font-bold text-gold-400">Men’s</h3>
            <p className="mt-1 text-sm text-navy-100">
              Competitive men’s teams with a pathway from social training into matches and beyond.
            </p>
          </div>
          <div className="rounded-xl bg-navy-800 p-4">
            <h3 className="font-bold text-gold-400">Women’s</h3>
            <p className="mt-1 text-sm text-navy-100">
              A growing women’s team — all experience levels welcome, from first kick to representative
              footy.
            </p>
          </div>
          <div className="rounded-xl bg-navy-800 p-4">
            <h3 className="font-bold text-gold-400">Mixed &amp; social</h3>
            <p className="mt-1 text-sm text-navy-100">
              Coed and social sessions if you just want to give it a go, get fit, or meet the club.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-8 text-center">
        <Link
          to="/signup"
          className="inline-block rounded-xl bg-burgundy-600 px-8 py-3 text-base font-bold text-white shadow hover:bg-burgundy-700"
        >
          Sign up — a volunteer will be in touch
        </Link>
      </section>
    </div>
  )
}

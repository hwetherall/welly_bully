import { insforge } from './insforge'
import { icsEventUrl, icsFeedUrl } from './calendar'
import type { PublicEvent, PublicEventRow } from './types'

const EVENT_COLUMNS = 'id, type, title, venue, venue_url, starts_at, ends_at, time_zone, description'

// Columns the landing page additionally needs for the change banner + .ics links
// (all on the events row; anon RLS still limits rows to published + public).
const PUBLIC_EVENT_COLUMNS = `${EVENT_COLUMNS}, uid, status, audience, revision, material_change, change_note, updated_at`

// Next confirmed public session (plan P0.1): published + public + upcoming, soonest first.
// The anon role has SELECT on published public events only (RLS), so this is the public-safe query.
export async function fetchNextPublicEvent(): Promise<{ event: PublicEvent | null; error: string | null }> {
  const { data, error } = await insforge.database
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('status', 'published')
    .eq('audience', 'public')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1)

  if (error) return { event: null, error: error.message }
  return { event: (data?.[0] as PublicEvent | undefined) ?? null, error: null }
}

// Upcoming published public sessions for the "preferred session" select on /signup
// and the "Upcoming sessions" list on the landing page (plan P1.1).
export async function fetchUpcomingPublicEvents(
  limit = 10
): Promise<{ events: PublicEvent[]; error: string | null }> {
  const { data, error } = await insforge.database
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('status', 'published')
    .eq('audience', 'public')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(limit)

  if (error) return { events: [], error: error.message }
  return { events: (data ?? []) as PublicEvent[], error: null }
}

// Upcoming published public sessions with uid/banner columns (landing page list).
export async function fetchUpcomingPublicEventRows(
  limit = 8
): Promise<{ events: PublicEventRow[]; error: string | null }> {
  const { data, error } = await insforge.database
    .from('events')
    .select(PUBLIC_EVENT_COLUMNS)
    .eq('status', 'published')
    .eq('audience', 'public')
    .gte('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(limit)

  if (error) return { events: [], error: error.message }
  return { events: (data ?? []) as PublicEventRow[], error: null }
}

// WF-04 step 2: the latest material change on a published public event drives
// the dismissible change banner on the landing page.
export async function fetchLatestChangeBannerEvent(): Promise<{ event: PublicEventRow | null; error: string | null }> {
  const { data, error } = await insforge.database
    .from('events')
    .select(PUBLIC_EVENT_COLUMNS)
    .eq('status', 'published')
    .eq('audience', 'public')
    .eq('material_change', true)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) return { event: null, error: error.message }
  return { event: (data?.[0] as PublicEventRow | undefined) ?? null, error: null }
}

//------------------------------------------------------------------------
// Public .ics feed URLs (functions/events-ics.ts, plan P1.2)
//------------------------------------------------------------------------

function insforgeBaseUrl(): string {
  return (import.meta.env.VITE_INSFORGE_URL as string | undefined) ?? ''
}

/** Subscribable feed of all published public events. */
export function publicIcsFeedUrl(): string {
  return icsFeedUrl(insforgeBaseUrl())
}

/** Single-event "Add to calendar" download URL for an event uid. */
export function publicIcsEventUrl(uid: string): string {
  return icsEventUrl(insforgeBaseUrl(), uid)
}

import { insforge } from './insforge'
import type { PublicEvent } from './types'

const EVENT_COLUMNS = 'id, type, title, venue, venue_url, starts_at, ends_at, time_zone, description'

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

// Upcoming published public sessions for the "preferred session" select on /signup.
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

// functions/events-ics.ts — public iCalendar feed (plan P1.2).
//
// GET {base}/functions/events-ics          -> feed of all published + cancelled public events
// GET {base}/functions/events-ics?uid=<uid> -> single-event "Add to calendar" download
//
// Semantics (plan P1.2 / WF-04): stable UID = events.uid; SEQUENCE = events.revision;
// cancelled events stay in the feed with STATUS:CANCELLED (explicit cancellation);
// TZID=America/Denver with an embedded VTIMEZONE. Subscriptions are eventually
// consistent in Google/Outlook — the feed itself is always current.
//
// Deploy: npx -y @insforge/cli functions deploy events-ics --file functions/events-ics.ts

import { createAdminClient } from 'npm:@insforge/sdk';

const TZ = 'America/Denver';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function esc(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// timestamptz -> local wall-clock in TZ as ICS basic format (floating with TZID)
function icsLocal(ts: string, timeZone: string): string {
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}${get('month')}${get('day')}T${get('hour') === '24' ? '00' : get('hour')}${get('minute')}${get('second')}`;
}

function icsUtc(ts: string): string {
  return new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function fold(line: string): string {
  // RFC 5545 line folding at 75 octets (approximate by chars; fine for our content)
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length > 0) { out += '\r\n ' + rest.slice(0, 74); rest = rest.slice(74); }
  return out;
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:America/Denver',
  'BEGIN:STANDARD',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'TZOFFSETFROM:-0600',
  'TZOFFSETTO:-0700',
  'TZNAME:MST',
  'END:STANDARD',
  'BEGIN:DAYLIGHT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'TZOFFSETFROM:-0700',
  'TZOFFSETTO:-0600',
  'TZNAME:MDT',
  'END:DAYLIGHT',
  'END:VTIMEZONE',
].join('\r\n');

export default async function (req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const baseUrl = Deno.env.get('INSFORGE_BASE_URL');
  const apiKey = Deno.env.get('API_KEY');
  if (!baseUrl || !apiKey) {
    return new Response(JSON.stringify({ error: 'secrets missing' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
  const admin = createAdminClient({ baseUrl, apiKey });

  const url = new URL(req.url);
  const uid = url.searchParams.get('uid');

  let q = admin.database
    .from('events')
    .select('uid,type,title,venue,venue_url,starts_at,ends_at,time_zone,description,status,revision,updated_at')
    .in('status', ['published', 'cancelled'])
    .eq('audience', 'public')
    .order('starts_at', { ascending: true })
    .limit(500);
  if (uid) q = q.eq('uid', uid);
  const { data: events, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: 'feed_failed', message: error.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
  }

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Denver Bulldogs//Bulldogs OS//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:Denver Bulldogs (${uid ? 'event' : 'all public events'})`,
    `X-WR-TIMEZONE:${TZ}`,
    VTIMEZONE,
  ];

  for (const e of events ?? []) {
    const tz = e.time_zone || TZ;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${icsUtc(e.updated_at)}`,
      `DTSTART;TZID=${tz}:${icsLocal(e.starts_at, tz)}`,
      `DTEND;TZID=${tz}:${icsLocal(e.ends_at, tz)}`,
      `SEQUENCE:${e.revision ?? 1}`,
      `STATUS:${e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
      `SUMMARY:${esc(e.title)}`,
      e.venue ? `LOCATION:${esc(e.venue)}${e.venue_url ? `\\,${esc(e.venue_url)}` : ''}` : null,
      e.description ? `DESCRIPTION:${esc(e.description)}` : null,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');

  const body = lines.filter((l): l is string => l !== null).map(fold).join('\r\n') + '\r\n';
  const headers: Record<string, string> = {
    ...cors,
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': 'no-cache',
  };
  if (uid) headers['Content-Disposition'] = `attachment; filename="${uid}.ics"`;
  return new Response(body, { status: 200, headers });
}

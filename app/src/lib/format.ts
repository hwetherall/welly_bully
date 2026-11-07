// Date/time formatting for events, always in the event's own time zone
// (schema default: America/Denver — never rely on the visitor's device zone).

const DATE_FMT = (timeZone: string) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  })

const TIME_FMT = (timeZone: string) =>
  new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  })

/** "Wednesday, March 3, 2027" in the event's time zone. */
export function formatEventDate(startsAt: string, timeZone = 'America/Denver'): string {
  return DATE_FMT(timeZone).format(new Date(startsAt))
}

/** "6:00 PM – 8:00 PM MST" in the event's time zone. */
export function formatEventTimeRange(startsAt: string, endsAt: string, timeZone = 'America/Denver'): string {
  return `${TIME_FMT(timeZone).format(new Date(startsAt))} – ${TIME_FMT(timeZone).format(new Date(endsAt))}`
}

/** Short timestamp for admin tables, in the event's/Denver zone: "Mar 3, 2027, 6:00 PM". */
export function formatTimestamp(iso: string, timeZone = 'America/Denver'): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso))
}

import { useCallback, useEffect, useState } from 'react'
import { fetchLatestChangeBannerEvent, fetchUpcomingPublicEventRows } from '../lib/events'
import type { PublicEventRow } from '../lib/types'

export type PublicEventsState<T> =
  | { status: 'loading'; rows: null; error: null }
  | { status: 'error'; rows: null; error: string }
  | { status: 'done'; rows: T; error: null }

/** Upcoming published public sessions for the landing page (plan P1.1). */
export function useUpcomingPublicEvents(limit = 8): PublicEventsState<PublicEventRow[]> & { reload: () => void } {
  const [state, setState] = useState<PublicEventsState<PublicEventRow[]>>({ status: 'loading', rows: null, error: null })

  const reload = useCallback(async () => {
    setState({ status: 'loading', rows: null, error: null })
    const { events, error } = await fetchUpcomingPublicEventRows(limit)
    setState(error ? { status: 'error', rows: null, error } : { status: 'done', rows: events, error: null })
  }, [limit])

  useEffect(() => {
    void reload()
  }, [reload])

  return { ...state, reload }
}

/** Latest material change on a published public event (WF-04 change banner). */
export function useChangeBannerEvent(): PublicEventsState<PublicEventRow | null> & { reload: () => void } {
  const [state, setState] = useState<PublicEventsState<PublicEventRow | null>>({ status: 'loading', rows: null, error: null })

  const reload = useCallback(async () => {
    setState({ status: 'loading', rows: null, error: null })
    const { event, error } = await fetchLatestChangeBannerEvent()
    setState(error ? { status: 'error', rows: null, error } : { status: 'done', rows: event, error: null })
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { ...state, reload }
}

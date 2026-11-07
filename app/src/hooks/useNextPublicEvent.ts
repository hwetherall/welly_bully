import { useCallback, useEffect, useState } from 'react'
import { fetchNextPublicEvent } from '../lib/events'
import type { PublicEvent } from '../lib/types'

export type NextEventState =
  | { status: 'loading'; event: null; error: null }
  | { status: 'error'; event: null; error: string }
  | { status: 'done'; event: PublicEvent | null; error: null }

// Shared by the landing page and /thanks: the next confirmed public session.
export function useNextPublicEvent(): NextEventState & { reload: () => void } {
  const [state, setState] = useState<NextEventState>({ status: 'loading', event: null, error: null })

  const reload = useCallback(async () => {
    setState({ status: 'loading', event: null, error: null })
    const { event, error } = await fetchNextPublicEvent()
    setState(
      error
        ? { status: 'error', event: null, error }
        : { status: 'done', event, error: null }
    )
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { ...state, reload }
}

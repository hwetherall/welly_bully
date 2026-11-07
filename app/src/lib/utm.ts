// UTM capture for enquiry source attribution (plan P0.1 analytics).
// Pure function of the query string so it is unit-testable.

export interface UtmParams {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
}

export function parseUtm(search: string): UtmParams {
  const params = new URLSearchParams(search)
  const pick = (key: string): string | undefined => {
    const v = params.get(key)
    return v && v.trim() !== '' ? v : undefined
  }
  return {
    utm_source: pick('utm_source'),
    utm_medium: pick('utm_medium'),
    utm_campaign: pick('utm_campaign'),
  }
}

import { describe, expect, it } from 'vitest'
import { parseUtm } from '../utm'

describe('parseUtm', () => {
  it('extracts utm params from a query string', () => {
    expect(
      parseUtm('?utm_source=instagram&utm_medium=social&utm_campaign=preseason&foo=bar')
    ).toEqual({ utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'preseason' })
  })

  it('returns empty object for missing/blank params', () => {
    expect(parseUtm('')).toEqual({})
    expect(parseUtm('?utm_source=')).toEqual({})
    expect(parseUtm('?other=1')).toEqual({})
  })
})

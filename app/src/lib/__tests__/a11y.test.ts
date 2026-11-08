import { describe, expect, it } from 'vitest'
import { alertRegionProps, contrastRatio, liveRegionProps, MAIN_CONTENT_ID } from '../a11y'

// Theme tokens from tailwind.config.js (keep in sync).
const NAVY_800 = '#0A1E3C' // body text on white cards
const NAVY_900 = '#081426' // header/footer background
const NAVY_950 = '#060F22' // page background
const NAVY_100 = '#D7E0EE' // light text on dark surfaces
const GOLD_400 = '#F5B942' // accent text on dark surfaces
const GOLD_500 = '#E8A812' // button background (paired with navy-950 text)
const WHITE = '#FFFFFF'

describe('a11y live-region helpers', () => {
  it('exposes a polite, atomic status region and an assertive alert region', () => {
    expect(liveRegionProps).toEqual({ role: 'status', 'aria-live': 'polite', 'aria-atomic': true })
    expect(alertRegionProps.role).toBe('alert')
    expect(alertRegionProps['aria-live']).toBe('assertive')
    expect(MAIN_CONTENT_ID).toBe('main-content')
  })
})

describe('contrastRatio — theme tokens (WCAG AA: text needs >= 4.5:1)', () => {
  it('passes for text pairs used on light and dark surfaces', () => {
    expect(contrastRatio(NAVY_800, WHITE)).toBeGreaterThanOrEqual(4.5) // card body text
    expect(contrastRatio(NAVY_100, NAVY_900)).toBeGreaterThanOrEqual(4.5) // nav/footer text
    expect(contrastRatio(GOLD_400, NAVY_900)).toBeGreaterThanOrEqual(4.5) // logo/links on dark
    expect(contrastRatio(NAVY_950, GOLD_500)).toBeGreaterThanOrEqual(4.5) // gold button label
  })

  it('documents that gold is never used as text on white (< 4.5:1, accent-only)', () => {
    expect(contrastRatio(GOLD_500, WHITE)).toBeLessThan(4.5)
    expect(contrastRatio(GOLD_400, WHITE)).toBeLessThan(4.5)
  })
})

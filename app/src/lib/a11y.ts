// Accessibility helpers (Sprint 5 pass). CSS-side guards (focus-visible,
// prefers-reduced-motion) live in styles.css; these are the testable JS parts.

/** id of the <main> landmark that the skip-to-content link targets. */
export const MAIN_CONTENT_ID = 'main-content'

/**
 * Props for an async status live region: screen readers announce changes politely
 * without interrupting. Use on admin form status banners (save ok / queued / etc).
 */
export const liveRegionProps = {
  role: 'status',
  'aria-live': 'polite',
  'aria-atomic': true,
} as const

/** Props for error announcements (assertive). */
export const alertRegionProps = {
  role: 'alert',
  'aria-live': 'assertive',
  'aria-atomic': true,
} as const

/** WCAG 2.x contrast ratio between two sRGB hex colors (#rgb or #rrggbb), 1..21. */
export function contrastRatio(hexA: string, hexB: string): number {
  const lum = (hex: string): number => {
    const h = hex.replace('#', '')
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  }
  const [l1, l2] = [lum(hexA), lum(hexB)]
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

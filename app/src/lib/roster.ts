// Pure helpers for Sprint 3 returning-player reconciliation UI (plan P0.7 / WF-03).
// UI-free on purpose so vitest can cover them — see src/lib/__tests__/roster.test.ts.
import type { Chip } from './admin'

const CHIP_BASE = 'inline-block rounded px-1.5 py-0.5 text-xs font-bold whitespace-nowrap'

//------------------------------------------------------------------------
// Match badges for create_roster_import preview rows
//------------------------------------------------------------------------

/** match values returned by rpc create_roster_import rows[].match. */
export const MATCH_KINDS = ['new', 'existing', 'duplicate_in_file', 'invalid'] as const
export type MatchKind = (typeof MATCH_KINDS)[number]

/**
 * Badge for a preview row: new = green, existing = blue, duplicate_in_file = amber,
 * invalid = red (with the RPC's reason appended to the label).
 */
export function matchChip(match: string, reason?: string | null): Chip {
  switch (match as MatchKind) {
    case 'new':
      return { label: 'new', className: `${CHIP_BASE} bg-green-100 text-green-800` }
    case 'existing':
      return { label: 'existing', className: `${CHIP_BASE} bg-blue-100 text-blue-800` }
    case 'duplicate_in_file':
      return { label: 'duplicate in file', className: `${CHIP_BASE} bg-amber-100 text-amber-800` }
    case 'invalid':
      return {
        label: reason ? `invalid — ${reason}` : 'invalid',
        className: `${CHIP_BASE} bg-red-100 text-red-800`,
      }
    default:
      return { label: match, className: `${CHIP_BASE} bg-gray-100 text-gray-700` }
  }
}

//------------------------------------------------------------------------
// Import status chips (data_imports.status: preview / confirmed)
//------------------------------------------------------------------------

export function importStatusChip(status: string): Chip {
  switch (status) {
    case 'confirmed':
      return { label: 'confirmed', className: `${CHIP_BASE} bg-green-100 text-green-800` }
    case 'preview':
      return { label: 'preview', className: `${CHIP_BASE} bg-amber-100 text-amber-800` }
    default:
      return { label: status, className: `${CHIP_BASE} bg-gray-100 text-gray-700` }
  }
}

//------------------------------------------------------------------------
// Summary chips for preview results / data_imports.summary jsonb
//------------------------------------------------------------------------

export interface SummaryChip {
  key: string
  label: string
  value: number
}

const SUMMARY_LABELS: [key: string, label: string][] = [
  ['total', 'total'],
  ['valid', 'valid'],
  ['new', 'new'],
  ['existing', 'existing'],
  ['duplicate_in_file', 'duplicates in file'],
  ['invalid', 'invalid'],
]

/** Ordered [label, value] chips from a create_roster_import result or data_imports.summary. */
export function summaryChips(summary: object | null | undefined): SummaryChip[] {
  if (!summary || typeof summary !== 'object') return []
  const rec = summary as Record<string, unknown>
  const chips: SummaryChip[] = []
  for (const [key, label] of SUMMARY_LABELS) {
    const v = Number(rec[key])
    if (Number.isFinite(v)) chips.push({ key, label, value: v })
  }
  return chips
}

/** Extra counts stored on a confirmed import's summary. */
export const CONFIRM_LABELS: [key: string, label: string][] = [
  ['people_created', 'people created'],
  ['people_matched', 'people matched'],
  ['participations_created', 'participations created'],
]

export function confirmChips(summary: object | null | undefined): SummaryChip[] {
  if (!summary || typeof summary !== 'object') return []
  const rec = summary as Record<string, unknown>
  const chips: SummaryChip[] = []
  for (const [key, label] of CONFIRM_LABELS) {
    const v = Number(rec[key])
    if (Number.isFinite(v)) chips.push({ key, label, value: v })
  }
  return chips
}

//------------------------------------------------------------------------
// Season resolution
//------------------------------------------------------------------------

export interface SeasonLike {
  id: string
  year: number
  name?: string
  state: string
}

/**
 * The "current" season, mirroring the returning_player_candidates view's CTE:
 * the highest-year season whose state is not 'closed'. Null when none exists.
 */
export function resolveCurrentSeason<T extends SeasonLike>(seasons: T[]): T | null {
  const open = seasons.filter((s) => s.state !== 'closed')
  if (open.length === 0) return null
  return open.reduce((best, s) => (s.year > best.year ? s : best))
}

/** Default target for the import season select: the latest season by year. */
export function latestSeason<T extends SeasonLike>(seasons: T[]): T | null {
  if (seasons.length === 0) return null
  return seasons.reduce((best, s) => (s.year > best.year ? s : best))
}

//------------------------------------------------------------------------
// Row shapes (mirrors migration 20261108023734_sprint3-roster-import.sql)
//------------------------------------------------------------------------

/** Row of rpc create_roster_import's rows[] array. */
export interface RosterPreviewRow {
  row_index: number
  match: MatchKind | string
  person_id?: string
  email?: string
  reason?: string
  row: Record<string, unknown>
}

/** Result of rpc create_roster_import. */
export interface RosterImportPreview {
  import_id: string
  total: number
  new: number
  existing: number
  duplicate_in_file: number
  invalid: number
  valid: number
  rows: RosterPreviewRow[]
}

/** Result of rpc confirm_roster_import. */
export interface RosterImportConfirm {
  ok: boolean
  import_id?: string
  already_confirmed?: boolean
  people_created?: number
  people_matched?: number
  participations_created?: number
}

/** Result of rpc create_reengagement_review. */
export interface ReengagementReviewResult {
  ok: boolean
  task_id?: string
  already_exists?: boolean
  owner_id?: string
}

/** Row of the returning_player_candidates view. */
export interface ReturningCandidate {
  person_id: string
  first_name: string
  last_name: string | null
  email: string
  phone: string | null
  previous_season_year: number
  current_season_year: number
  open_review_tasks: number
}

/** Row of public.data_imports as the past-imports list selects it. */
export interface DataImportRow {
  id: string
  filename: string
  status: string
  summary: Record<string, unknown> | null
  created_at: string
}

/** Row of public.seasons as the selects use it. */
export interface SeasonRow {
  id: string
  year: number
  name: string
  state: string
}

/** Full name for a candidate row, trimmed; falls back to email. */
export function candidateName(c: Pick<ReturningCandidate, 'first_name' | 'last_name' | 'email'>): string {
  const name = `${c.first_name} ${c.last_name ?? ''}`.trim()
  return name || c.email
}

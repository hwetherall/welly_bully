// Thin wrappers over the Sprint 3 SQL RPCs + read queries
// (migrations/20261108023734_sprint3-roster-import.sql). All RPCs are SECURITY
// DEFINER and permission-checked server-side (coordinator/admin only); each
// writes an audit_events row. Reads go through RLS: returning_player_candidates
// is staff-readable, data_imports is coordinator/admin-only.
import { insforge } from './insforge'
import type { RpcResult } from './crm-api'

/** Table-query result with a non-null rows array (PostgREST returns null data on error). */
export interface TableResult<T> {
  data: T[]
  error: { message: string } | null
}

import type {
  DataImportRow,
  ReengagementReviewResult,
  ReturningCandidate,
  RosterImportConfirm,
  RosterImportPreview,
  SeasonRow,
} from './roster'

/** rpc create_roster_import(p_filename, p_season_id, p_rows) — PREVIEW only, writes no people. */
export function createRosterImport(
  filename: string,
  seasonId: string,
  rows: Record<string, string>[]
): Promise<RpcResult<RosterImportPreview>> {
  return insforge.database.rpc('create_roster_import', {
    p_filename: filename,
    p_season_id: seasonId,
    p_rows: rows,
  }) as unknown as Promise<RpcResult<RosterImportPreview>>
}

/** rpc confirm_roster_import(p_import_id) — the only write path; idempotent per import. */
export function confirmRosterImport(importId: string): Promise<RpcResult<RosterImportConfirm>> {
  return insforge.database.rpc('confirm_roster_import', { p_import_id: importId }) as unknown as Promise<RpcResult<RosterImportConfirm>>
}

/** rpc create_reengagement_review(p_person_id, p_season_id, p_owner_id?) — INTERNAL task only. */
export function createReengagementReview(
  personId: string,
  seasonId: string,
  ownerId?: string | null
): Promise<RpcResult<ReengagementReviewResult>> {
  return insforge.database.rpc('create_reengagement_review', {
    p_person_id: personId,
    p_season_id: seasonId,
    p_owner_id: ownerId ?? null,
  }) as unknown as Promise<RpcResult<ReengagementReviewResult>>
}

/** All seasons, newest year first (drives both season selects). */
export async function fetchSeasons(): Promise<TableResult<SeasonRow>> {
  const { data, error } = await insforge.database
    .from('seasons')
    .select('id, year, name, state')
    .order('year', { ascending: false })
  return { data: (data ?? []) as SeasonRow[], error: error ? { message: error.message } : null }
}

/** Past imports, newest first. RLS: coordinator/admin only — only call when canCoordinate. */
export async function fetchDataImports(limit = 50): Promise<TableResult<DataImportRow>> {
  const { data, error } = await insforge.database
    .from('data_imports')
    .select('id, filename, status, summary, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  return { data: (data ?? []) as DataImportRow[], error: error ? { message: error.message } : null }
}

/** returning_player_candidates view — staff-readable. */
export async function fetchReturningCandidates(): Promise<TableResult<ReturningCandidate>> {
  const { data, error } = await insforge.database
    .from('returning_player_candidates')
    .select('person_id, first_name, last_name, email, phone, previous_season_year, current_season_year, open_review_tasks')
    .order('last_name', { ascending: true, nullsFirst: false })
    .order('first_name', { ascending: true })
  return { data: (data ?? []) as ReturningCandidate[], error: error ? { message: error.message } : null }
}

/** user_roles join roles — used client-side to find volunteer user ids. */
export async function fetchUserRoleRows(): Promise<TableResult<{ user_id: string; roles: { name: string } | { name: string }[] | null }>> {
  const { data, error } = await insforge.database
    .from('user_roles')
    .select('user_id, roles(name)')
    .limit(200)
  return { data: (data ?? []) as { user_id: string; roles: { name: string } | { name: string }[] | null }[], error: error ? { message: error.message } : null }
}

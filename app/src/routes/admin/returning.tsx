import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Panel, type PanelState } from '../../components/admin-chrome'
import { useClubAuth } from '../../hooks/useClubAuth'
import { canCoordinate, volunteerIdsFromRoleRows } from '../../lib/crm'
import { ownerName } from '../../lib/admin'
import { createReengagementReview, fetchReturningCandidates, fetchSeasons, fetchUserRoleRows } from '../../lib/roster-api'
import { candidateName, resolveCurrentSeason, type ReturningCandidate, type SeasonRow } from '../../lib/roster'

export const Route = createFileRoute('/admin/returning')({
  component: ReturningPage,
})

type RowOutcome =
  | { kind: 'idle' }
  | { kind: 'confirm'; ownerId: string } // inline confirm armed for this row
  | { kind: 'busy' }
  | { kind: 'done'; alreadyExists: boolean }
  | { kind: 'error'; error: string }

// /admin/returning — returning-player reconciliation (plan P0.7 / WF-03).
// Lists returning_player_candidates: players active in a past (closed) season with no
// participation in the current season. Coordinators create INTERNAL review tasks only —
// nothing is ever sent to the player automatically (plan §9).
function ReturningPage() {
  const { user, roleNames, members } = useClubAuth()
  const canCoord = canCoordinate(roleNames)

  const [candidates, setCandidates] = useState<PanelState<ReturningCandidate[]>>({ status: 'loading' })
  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [volunteerIds, setVolunteerIds] = useState<string[]>([])
  const [outcomes, setOutcomes] = useState<Record<string, RowOutcome>>({})
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    setCandidates({ status: 'loading' })
    const [candRes, seasonRes, roleRes] = await Promise.all([
      fetchReturningCandidates(),
      fetchSeasons(),
      fetchUserRoleRows(),
    ])
    if (candRes.error) {
      setCandidates({ status: 'error', error: candRes.error.message })
    } else {
      setCandidates({ status: 'done', rows: candRes.data })
    }
    if (!seasonRes.error) setSeasons(seasonRes.data)
    if (!roleRes.error) setVolunteerIds(volunteerIdsFromRoleRows(roleRes.data))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const currentSeason = useMemo(() => resolveCurrentSeason(seasons), [seasons])

  // Owner options for a new review task: me (default) + club members holding the volunteer role
  const ownerOptions = useMemo(() => {
    const opts: { id: string; label: string }[] = []
    if (user) opts.push({ id: user.id, label: `Me (${user.email ?? 'you'})` })
    for (const id of volunteerIds) {
      if (id === user?.id) continue
      const m = members.find((mem) => mem.id === id)
      opts.push({ id, label: m?.full_name?.trim() || m?.email || 'Unknown volunteer' })
    }
    return opts
  }, [user, volunteerIds, members])

  function setOutcome(personId: string, o: RowOutcome) {
    setOutcomes((prev) => ({ ...prev, [personId]: o }))
  }

  async function runReview(personId: string, ownerId: string) {
    if (!currentSeason) {
      setOutcome(personId, { kind: 'error', error: 'No current (non-closed) season found — cannot create a review task.' })
      return
    }
    setOutcome(personId, { kind: 'busy' })
    const { data, error } = await createReengagementReview(personId, currentSeason.id, ownerId)
    if (error || !data) {
      setOutcome(personId, { kind: 'error', error: error?.message ?? 'Could not create the review task.' })
      return
    }
    setOutcome(personId, { kind: 'done', alreadyExists: Boolean(data.already_exists) })
    setBanner({
      kind: 'success',
      text: data.already_exists
        ? 'A review task is already open for this player.'
        : `Internal review task created for ${currentSeason.year} (owner: ${ownerName(data.owner_id ?? ownerId, members)}). Nothing was sent to the player.`,
    })
    await load() // refresh open_review_tasks badges
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Returning players to review"
        state={candidates}
        empty="No one to reconcile right now: everyone active in a past season already has a participation in the current season. Import last season's roster from the Import page to populate this list."
      >
        {(rows) => (
          <div>
            <p className="border-b border-navy-100 px-4 py-3 text-sm text-navy-600">
              Players who were active in a past (closed) season but have <strong>no participation in the current
              season</strong> ({currentSeason ? `${currentSeason.year}` : '—'}). Review tasks are{' '}
              <strong>internal only</strong> — a human checks history, consent and appropriateness before any manual
              outreach (WF-03).
              {!canCoord && ' Volunteers can view this list; only coordinators and admins can create review tasks.'}
            </p>
            {banner && (
              <div
                role="status"
                className={`mx-4 mt-3 rounded-lg p-3 text-sm font-medium ${
                  banner.kind === 'success' ? 'bg-green-100 text-green-800' : 'bg-burgundy-100 text-burgundy-800'
                }`}
              >
                {banner.text}
                <button type="button" onClick={() => setBanner(null)} className="ml-2 underline" aria-label="Dismiss message">
                  dismiss
                </button>
              </div>
            )}
            {!currentSeason && (
              <div role="alert" className="m-4 rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
                No current (non-closed) season exists, so review tasks cannot be created yet. Ask an admin to open a
                season.
              </div>
            )}
            <table className="min-w-full text-left text-sm text-navy-800">
              <thead>
                <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Seasons</th>
                  <th className="px-3 py-2">Open reviews</th>
                  {canCoord && <th className="px-3 py-2">Action</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const outcome = outcomes[c.person_id] ?? { kind: 'idle' } as RowOutcome
                  return (
                    <tr key={c.person_id} className="border-b border-navy-100 last:border-0 align-top hover:bg-navy-100/40">
                      <td className="px-3 py-2 font-medium">{candidateName(c)}</td>
                      <td className="px-3 py-2">{c.email}</td>
                      <td className="px-3 py-2">{c.phone ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {c.previous_season_year} → {c.current_season_year}
                      </td>
                      <td className="px-3 py-2">
                        {c.open_review_tasks > 0 ? (
                          <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">
                            {c.open_review_tasks} open
                          </span>
                        ) : (
                          <span className="text-navy-600">—</span>
                        )}
                      </td>
                      {canCoord && (
                        <td className="px-3 py-2">
                          {outcome.kind === 'idle' && (
                            <button
                              type="button"
                              onClick={() => setOutcome(c.person_id, { kind: 'confirm', ownerId: user?.id ?? '' })}
                              className="rounded-lg bg-navy-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-navy-700"
                            >
                              Create review task
                            </button>
                          )}
                          {outcome.kind === 'confirm' && (
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <label htmlFor={`owner-${c.person_id}`} className="text-xs font-semibold text-navy-600">
                                  Owner
                                </label>
                                <select
                                  id={`owner-${c.person_id}`}
                                  value={outcome.ownerId}
                                  onChange={(e) => setOutcome(c.person_id, { kind: 'confirm', ownerId: e.target.value })}
                                  className="rounded-lg border border-navy-100 px-2 py-1 text-xs text-navy-900"
                                >
                                  {ownerOptions.map((o) => (
                                    <option key={o.id} value={o.id}>
                                      {o.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => void runReview(c.person_id, outcome.ownerId)}
                                  className="rounded-lg bg-burgundy-700 px-3 py-1.5 text-xs font-bold text-white"
                                >
                                  Confirm — create internal task
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setOutcome(c.person_id, { kind: 'idle' })}
                                  className="rounded-lg border border-navy-100 px-3 py-1.5 text-xs font-semibold text-navy-800"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}
                          {outcome.kind === 'busy' && <span className="text-xs text-navy-600">Creating task…</span>}
                          {outcome.kind === 'done' && (
                            <span role="status" className="text-xs font-semibold text-green-800">
                              {outcome.alreadyExists ? 'Review task already open' : 'Review task created'}
                            </span>
                          )}
                          {outcome.kind === 'error' && (
                            <div role="alert" className="text-xs font-medium text-burgundy-700">
                              {outcome.error}{' '}
                              <button type="button" className="underline" onClick={() => setOutcome(c.person_id, { kind: 'idle' })}>
                                dismiss
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

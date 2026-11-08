import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Panel, type PanelState } from '../../components/admin-chrome'
import { useClubAuth } from '../../hooks/useClubAuth'
import { canCoordinate } from '../../lib/crm'
import { downloadSampleCsv, parseRosterCsv } from '../../lib/csv'
import { formatTimestamp } from '../../lib/format'
import { confirmRosterImport, createRosterImport, fetchDataImports, fetchSeasons } from '../../lib/roster-api'
import {
  importStatusChip,
  latestSeason,
  matchChip,
  summaryChips,
  confirmChips,
  type DataImportRow,
  type RosterImportConfirm,
  type RosterImportPreview,
  type SeasonRow,
} from '../../lib/roster'

export const Route = createFileRoute('/admin/import')({
  component: ImportPage,
})

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; importId: string; result: RosterImportPreview }

type ConfirmState =
  | { status: 'idle' }
  | { status: 'awaiting' } // inline confirm armed
  | { status: 'busy' }
  | { status: 'error'; error: string }
  | { status: 'done'; result: RosterImportConfirm }

// /admin/import — two-phase roster import (plan P0.7): CSV in, create_roster_import
// preview (writes nothing to people), then an explicit confirm via confirm_roster_import.
// Imported players get NO contact consent (plan §9) — review tasks live on /admin/returning.
function ImportPage() {
  const { roleNames } = useClubAuth()
  const canCoord = canCoordinate(roleNames)

  const [seasons, setSeasons] = useState<PanelState<SeasonRow[]>>({ status: 'loading' })
  const [seasonId, setSeasonId] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [parseErrors, setParseErrors] = useState<{ line: number; message: string }[]>([])
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' })
  const [confirm, setConfirm] = useState<ConfirmState>({ status: 'idle' })
  const [imports, setImports] = useState<PanelState<DataImportRow[]>>({ status: 'loading' })
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Seasons for the target select (default: latest by year); past imports are
  // coordinator/admin-only by RLS, so only load them for coordinators.
  useEffect(() => {
    let cancelled = false
    async function load() {
      setSeasons({ status: 'loading' })
      const { data, error } = await fetchSeasons()
      if (cancelled) return
      if (error) {
        setSeasons({ status: 'error', error: error.message })
        return
      }
      setSeasons({ status: 'done', rows: data })
      const latest = latestSeason(data)
      if (latest) setSeasonId((prev) => prev || latest.id)

      if (canCoord) {
        setImports({ status: 'loading' })
        const res = await fetchDataImports()
        if (!cancelled) setImports(res.error ? { status: 'error', error: res.error.message } : { status: 'done', rows: res.data })
      } else {
        setImports({ status: 'done', rows: [] })
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [canCoord])

  async function handleFile(file: File | undefined | null) {
    if (!file) return
    setFileName(file.name)
    setParseErrors([])
    setPreview({ status: 'idle' })
    setConfirm({ status: 'idle' })
    if (!seasonId) {
      setPreview({ status: 'error', error: 'Choose a season first — no season is selected.' })
      return
    }
    const text = await file.text()
    const parsed = parseRosterCsv(text)
    if (parsed.errors.length > 0) {
      setParseErrors(parsed.errors)
      setPreview({ status: 'error', error: `Could not read ${file.name}: ${parsed.errors.length} problem(s) — first: line ${parsed.errors[0].line}: ${parsed.errors[0].message}` })
      return
    }
    if (parsed.rows.length === 0) {
      setPreview({ status: 'error', error: `No data rows in ${file.name} — only the header row was found.` })
      return
    }
    setPreview({ status: 'loading' })
    const { data, error } = await createRosterImport(file.name, seasonId, parsed.rows)
    if (error || !data) {
      setPreview({ status: 'error', error: error?.message ?? 'Import preview failed.' })
      return
    }
    setPreview({ status: 'ready', importId: data.import_id, result: data })
  }

  async function onConfirm() {
    if (preview.status !== 'ready') return
    if (confirm.status === 'awaiting') {
      setConfirm({ status: 'busy' })
      const { data, error } = await confirmRosterImport(preview.importId)
      if (error || !data) {
        setConfirm({ status: 'error', error: error?.message ?? 'Confirm failed.' })
        return
      }
      setConfirm({ status: 'done', result: data })
      // refresh past imports
      const res = await fetchDataImports()
      if (!res.error) setImports({ status: 'done', rows: res.data })
      // keep the preview visible but mark it consumed
      setPreview({ status: 'idle' })
      setFileName(null)
      if (inputRef.current) inputRef.current.value = ''
    } else {
      setConfirm({ status: 'awaiting' })
    }
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    void handleFile(e.target.files?.[0])
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    void handleFile(e.dataTransfer.files?.[0])
  }

  const seasonRows = seasons.status === 'done' ? seasons.rows : []

  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-white p-4 shadow" aria-labelledby="import-heading">
        <h2 id="import-heading" className="text-lg font-extrabold text-navy-800">
          Import a roster CSV
        </h2>
        <p className="mt-1 text-sm text-navy-600">
          Preview matches against existing players first; nothing is written until you confirm. Imported players are
          created <strong>without contact consent</strong> — reach out only via a human-reviewed task on the Returning
          page (plan §9).
        </p>

        {!canCoord && (
          <div role="alert" className="mt-3 rounded-lg bg-amber-100 p-3 text-sm font-medium text-amber-800">
            Only coordinators and admins can run imports. You can still see past imports below if your role allows.
          </div>
        )}

        {seasons.status === 'loading' && <p className="mt-3 text-sm text-navy-600">Loading seasons…</p>}
        {seasons.status === 'error' && (
          <div role="alert" className="mt-3 rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
            Could not load seasons: {seasons.error}
          </div>
        )}
        {seasons.status === 'done' && seasons.rows.length === 0 && (
          <div role="alert" className="mt-3 rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
            No seasons exist yet — ask an admin to create one before importing.
          </div>
        )}

        {seasons.status === 'done' && seasons.rows.length > 0 && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="import-season" className="block text-xs font-semibold uppercase text-navy-600">
                Season to import into
              </label>
              <select
                id="import-season"
                value={seasonId}
                onChange={(e) => setSeasonId(e.target.value)}
                disabled={!canCoord}
                className="mt-1 rounded-lg border border-navy-100 px-2 py-1.5 text-sm text-navy-900 disabled:opacity-60"
              >
                {seasonRows.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.year} — {s.name} ({s.state})
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => downloadSampleCsv()}
              className="rounded-lg border border-navy-100 px-3 py-1.5 text-sm font-semibold text-navy-800 hover:bg-navy-100/40"
            >
              Download sample CSV
            </button>
          </div>
        )}

        {canCoord && seasons.status === 'done' && seasons.rows.length > 0 && (
          <div className="mt-4">
            <label htmlFor="import-file" className="block text-xs font-semibold uppercase text-navy-600">
              CSV file
            </label>
            <input
              ref={inputRef}
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={onPick}
              className="mt-1 block w-full text-sm text-navy-900 file:mr-3 file:rounded-lg file:border file:border-navy-100 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-navy-800"
            />
            <div
              role="button"
              tabIndex={0}
              aria-label="Drop a CSV file here, or press Enter to choose one"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  inputRef.current?.click()
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`mt-2 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm ${
                dragOver ? 'border-gold-500 bg-gold-300/30 text-navy-900' : 'border-navy-100 text-navy-600'
              }`}
            >
              {fileName ? `Selected: ${fileName}` : 'Drag & drop a CSV here, or click to choose a file'}
            </div>
            <p className="mt-1 text-xs text-navy-600">
              Expected headers (any order, any case): first_name, last_name, email, phone, pathway, membership_status.
              Header row required.
            </p>
          </div>
        )}

        {parseErrors.length > 0 && (
          <div role="alert" className="mt-3 rounded-lg bg-burgundy-100 p-3 text-sm text-burgundy-800">
            <p className="font-semibold">{parseErrors.length} file problem(s):</p>
            <ul className="mt-1 list-disc pl-5">
              {parseErrors.slice(0, 10).map((p, i) => (
                <li key={i}>
                  line {p.line}: {p.message}
                </li>
              ))}
              {parseErrors.length > 10 && <li>…and {parseErrors.length - 10} more</li>}
            </ul>
          </div>
        )}

        {preview.status === 'loading' && <p className="mt-3 text-sm text-navy-600">Building preview…</p>}
        {preview.status === 'error' && (
          <div role="alert" className="mt-3 rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
            {preview.error}
          </div>
        )}

        {preview.status === 'ready' && (
          <div className="mt-4">
            <div className="flex flex-wrap gap-2" aria-label="Import summary">
              {summaryChips(preview.result).map((c) => (
                <span key={c.key} className="rounded-lg bg-navy-100 px-2 py-1 text-xs font-bold text-navy-800">
                  {c.label}: {c.value}
                </span>
              ))}
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm text-navy-800">
                <thead>
                  <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.result.rows.map((r) => {
                    const chip = matchChip(r.match, r.reason)
                    const row = (r.row ?? {}) as Record<string, unknown>
                    const name = `${String(row.first_name ?? '')} ${String(row.last_name ?? '')}`.trim()
                    return (
                      <tr key={r.row_index} className="border-b border-navy-100 last:border-0">
                        <td className="px-3 py-2 text-navy-600">{r.row_index}</td>
                        <td className="px-3 py-2">{name || '—'}</td>
                        <td className="px-3 py-2">{r.email ?? String(row.email ?? '—')}</td>
                        <td className="px-3 py-2">
                          <span className={chip.className}>{chip.label}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void onConfirm()}
                disabled={confirm.status === 'busy'}
                className={`rounded-xl px-5 py-2.5 font-bold text-white disabled:opacity-60 ${
                  confirm.status === 'awaiting' ? 'bg-burgundy-700' : 'bg-navy-800'
                }`}
              >
                {confirm.status === 'busy'
                  ? 'Importing…'
                  : confirm.status === 'awaiting'
                    ? 'Click again to confirm the import'
                    : 'Confirm import'}
              </button>
              {confirm.status === 'awaiting' && (
                <button
                  type="button"
                  onClick={() => setConfirm({ status: 'idle' })}
                  className="rounded-lg border border-navy-100 px-3 py-2 text-sm font-semibold text-navy-800"
                >
                  Cancel
                </button>
              )}
              <p className="text-xs text-navy-600">
                Preview only — nothing is written to players until you confirm.
              </p>
            </div>
            {confirm.status === 'error' && (
              <div role="alert" className="mt-3 rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
                Confirm failed: {confirm.error}
              </div>
            )}
          </div>
        )}

        {confirm.status === 'done' && (
          <div role="status" className="mt-4 rounded-lg bg-green-100 p-4 text-sm text-green-800">
            <p className="font-bold">
              {confirm.result.already_confirmed ? 'This import was already confirmed.' : 'Import confirmed.'}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {confirmChips({
                people_created: confirm.result.people_created,
                people_matched: confirm.result.people_matched,
                participations_created: confirm.result.participations_created,
              }).map((c) => (
                <span key={c.key} className="rounded bg-white/70 px-2 py-1 text-xs font-bold text-green-900">
                  {c.label}: {c.value}
                </span>
              ))}
            </div>
            <p className="mt-2">
              Imported players have <strong>no contact consent</strong>. Create internal review tasks on the{' '}
              <a href="/admin/returning" className="font-semibold underline">
                Returning page
              </a>{' '}
              before anyone reaches out.
            </p>
          </div>
        )}
      </section>

      <Panel
        title="Past imports"
        state={imports}
        empty={canCoord ? 'No imports yet — your previewed and confirmed CSVs will appear here.' : 'Past imports are visible to coordinators and admins.'}
      >
        {(rows) => (
          <table className="min-w-full text-left text-sm text-navy-800">
            <thead>
              <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                <th className="px-3 py-2">File</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Counts</th>
                <th className="px-3 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((imp) => {
                const chip = importStatusChip(imp.status)
                return (
                  <tr key={imp.id} className="border-b border-navy-100 last:border-0">
                    <td className="px-3 py-2 font-medium">{imp.filename}</td>
                    <td className="px-3 py-2">
                      <span className={chip.className}>{chip.label}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {summaryChips(imp.summary).map((c) => (
                          <span key={c.key} className="rounded bg-navy-100 px-1.5 py-0.5 text-xs font-semibold text-navy-800">
                            {c.label} {c.value}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(imp.created_at)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}

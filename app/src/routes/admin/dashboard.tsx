import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Panel, type PanelState } from '../../components/admin-chrome'
import { recruitmentStats } from '../../lib/crm-api'
import { STATS_WINDOWS, formatPct, sortedCountEntries, statsSinceIso } from '../../lib/crm'
import type { RecruitmentStats } from '../../lib/types'

export const Route = createFileRoute('/admin/dashboard')({
  component: DashboardPage,
})

// /admin/dashboard — coordinator scoreboard (plan P0.6, §7 metric definitions).
// All numbers come from rpc recruitment_stats(p_since); staff-only, aggregate-only.
function DashboardPage() {
  const [windowDays, setWindowDays] = useState<number>(30)
  const [stats, setStats] = useState<PanelState<RecruitmentStats[]>>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setStats({ status: 'loading' })
      const { data, error } = await recruitmentStats(statsSinceIso(windowDays))
      if (cancelled) return
      if (error) {
        setStats({ status: 'error', error: error.message })
        return
      }
      setStats({ status: 'done', rows: [(data ?? {}) as RecruitmentStats] })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [windowDays])

  const s = stats.status === 'done' ? stats.rows[0] : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Stats window">
        <span className="text-sm font-semibold text-navy-100">Window:</span>
        {STATS_WINDOWS.map((w) => (
          <button
            key={w.days}
            type="button"
            onClick={() => setWindowDays(w.days)}
            aria-pressed={windowDays === w.days}
            className={`rounded-lg border px-3 py-1.5 text-sm font-bold ${
              windowDays === w.days
                ? 'border-gold-500 bg-gold-500 text-navy-900'
                : 'border-navy-100 text-navy-100 hover:bg-navy-700'
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      <Panel title="Scoreboard" state={stats} empty="No stats returned.">
        {() => (
          <div className="space-y-6 p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard label="New enquiries" value={String(s!.new_enquiries_in_window)} hint={`last ${windowDays} days`} />
              <StatCard
                label="Attempted within 48h"
                value={formatPct(s!.pct_attempted_within_48h)}
                hint="primary operating metric"
              />
              <StatCard
                label="Median hours to first attempt"
                value={String(s!.median_hours_to_first_attempt)}
                hint="enquiry → first logged attempt"
              />
              <StatCard label="Overdue open tasks" value={String(s!.overdue_open_tasks)} hint="due before now" />
              <StatCard label="Unassigned enquiries" value={String(s!.unassigned_enquiries)} hint="stage new/assigned" />
              <StatCard
                label="First-training conversion"
                value={formatPct(s!.first_training_conversion_window)}
                hint={`${s!.first_training_attendance_window} attended in window`}
              />
            </div>

            <BarList title="Enquiries by stage (all time)" entries={sortedCountEntries(s!.enquiries_by_stage)} />
            <BarList
              title={`Enquiries by source (last ${windowDays} days)`}
              entries={sortedCountEntries(s!.enquiries_by_source_window)}
            />
          </div>
        )}
      </Panel>
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-navy-100 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-600">{label}</p>
      <p className="mt-1 text-2xl font-extrabold text-navy-900">{value}</p>
      <p className="mt-0.5 text-xs text-navy-600">{hint}</p>
    </div>
  )
}

function BarList({ title, entries }: { title: string; entries: [string, number][] }) {
  const max = entries.length > 0 ? Math.max(...entries.map(([, v]) => v)) : 0
  return (
    <section aria-label={title}>
      <h3 className="text-sm font-extrabold uppercase tracking-wide text-navy-600">{title}</h3>
      {entries.length === 0 && <p className="mt-2 text-sm text-navy-600">No data in this window.</p>}
      <ul className="mt-2 space-y-1.5">
        {entries.map(([label, count]) => (
          <li key={label} className="flex items-center gap-2 text-sm text-navy-800">
            <span className="w-40 shrink-0 truncate font-medium" title={label}>
              {label.replace(/_/g, ' ')}
            </span>
            <span className="h-4 rounded bg-gold-500" style={{ width: `${max > 0 ? (count / max) * 100 : 0}%`, minWidth: count > 0 ? 4 : 0 }} />
            <span className="font-bold">{count}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

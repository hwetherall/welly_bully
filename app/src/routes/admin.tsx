import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { insforge } from '../lib/insforge'
import { formatTimestamp } from '../lib/format'
import {
  displayNameFromUser,
  isOverdue,
  notificationStatusChip,
  ownerName,
  stageChip,
} from '../lib/admin'
import type { ActionQueueRow, ClubMember, EnquiryRow, NotificationJobRow } from '../lib/types'

export const Route = createFileRoute('/admin')({
  component: AdminPage,
})

type User = {
  id: string
  email?: string
  user_metadata?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  profile?: { name?: string } | null
}

type RoleRow = { role_id: number; roles: { name: string } | null }

type PanelState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'done'; rows: T[] }

/** Normalize a PostgREST to-one embed (`person:people(...)`, `roles(...)`),
 * which may arrive as an object or a single-element array. */
function toOne<T>(embed: T | T[] | null): T | null {
  return Array.isArray(embed) ? embed[0] ?? null : embed
}

// Admin dashboard (Sprint 1, plan P0.4/P0.6): InsForge auth sign-in, role check via
// user_roles, club_members upsert, then three panels — action queue, enquiries,
// notification jobs (failed/dry_run delivery stays visible, WF-01.7).
function AdminPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined) // undefined = checking session
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)

  const [roles, setRoles] = useState<RoleRow[] | null>(null)
  const [rolesError, setRolesError] = useState<string | null>(null)
  const [members, setMembers] = useState<ClubMember[]>([])
  const [queue, setQueue] = useState<PanelState<ActionQueueRow>>({ status: 'loading' })
  const [enquiries, setEnquiries] = useState<PanelState<EnquiryRow>>({ status: 'loading' })
  const [jobs, setJobs] = useState<PanelState<NotificationJobRow>>({ status: 'loading' })

  useEffect(() => {
    void insforge.auth.getCurrentUser().then(({ data }) => setUser(data?.user ?? null))
  }, [])

  // Once we have a session, load club roles; if the account is staff, mirror it
  // into club_members (best effort — RLS may deny, seeds cover the dev users)
  // and load the dashboard panels.
  useEffect(() => {
    if (!user) return
    let cancelled = false

    // club_members is written by admins only (migration 2 RLS + grants). Try an
    // upsert with the user session, fall back to insert-ignore-duplicates; if
    // both are blocked, skip silently — seeds already cover the 5 dev users.
    async function ensureClubMember(u: User) {
      const row = { id: u.id, email: u.email ?? '', full_name: displayNameFromUser(u) }
      const { error: upsertError } = await insforge.database
        .from('club_members')
        .upsert([row], { onConflict: 'id' })
      if (upsertError) {
        // on conflict do nothing (this postgrest-js exposes ignoreDuplicates on upsert only)
        const { error: insertError } = await insforge.database
          .from('club_members')
          .upsert([row], { onConflict: 'id', ignoreDuplicates: true })
        if (insertError) {
          console.warn('[admin] club_members upsert blocked by RLS, skipping:', insertError.message)
        }
      }
    }

    async function load() {
      setRoles(null)
      setRolesError(null)
      setQueue({ status: 'loading' })
      setEnquiries({ status: 'loading' })
      setJobs({ status: 'loading' })

      const { data, error } = await insforge.database
        .from('user_roles')
        .select('role_id, roles(name)')
        .eq('user_id', user!.id)
      if (cancelled) return
      if (error) {
        setRolesError(error.message)
        return
      }
      const roleRows: RoleRow[] = ((data ?? []) as unknown[]).map((r) => {
        const row = r as { role_id: number; roles: { name: string } | { name: string }[] | null }
        return { role_id: row.role_id, roles: toOne(row.roles) }
      })
      setRoles(roleRows)
      if (roleRows.length === 0) return // not a club account — no dashboard fetch

      void ensureClubMember(user!)

      // club_members directory, used to resolve owner names in every panel
      const { data: memberRows, error: membersError } = await insforge.database
        .from('club_members')
        .select('id, email, full_name')
      if (!cancelled && !membersError) setMembers((memberRows ?? []) as ClubMember[])

      // (a) Action queue: open/attempted/reassigned tasks, soonest due first (P0.6)
      const { data: queueRows, error: queueError } = await insforge.database
        .from('action_queue')
        .select('*')
        .order('due_at')
        .limit(50)
      if (cancelled) return
      setQueue(
        queueError
          ? { status: 'error', error: queueError.message }
          : { status: 'done', rows: (queueRows ?? []) as ActionQueueRow[] }
      )

      // (b) Enquiries: latest 50 with lead + stage + owner (P0.6)
      const { data: enquiryRows, error: enquiriesError } = await insforge.database
        .from('enquiries')
        .select('id,stage,created_at,assigned_to,utm_source,person:people(first_name,last_name,email)')
        .order('created_at', { ascending: false })
        .limit(50)
      if (cancelled) return
      setEnquiries(
        enquiriesError
          ? { status: 'error', error: enquiriesError.message }
          : { status: 'done', rows: (enquiryRows ?? []) as EnquiryRow[] }
      )

      // (c) Notification jobs: latest 50; failed/dry_run chips keep delivery
      // problems visible without losing the lead (WF-01.7)
      const { data: jobRows, error: jobsError } = await insforge.database
        .from('notification_jobs')
        .select('id,type,to_email,status,attempts,created_at,last_error')
        .order('created_at', { ascending: false })
        .limit(50)
      if (cancelled) return
      setJobs(
        jobsError
          ? { status: 'error', error: jobsError.message }
          : { status: 'done', rows: (jobRows ?? []) as NotificationJobRow[] }
      )
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [user])

  async function onSignIn(e: FormEvent) {
    e.preventDefault()
    setAuthError(null)
    setSigningIn(true)
    try {
      const { data, error } = await insforge.auth.signInWithPassword({ email, password })
      if (error) {
        setAuthError(error.message)
        return
      }
      setUser(data?.user ?? null)
    } finally {
      setSigningIn(false)
    }
  }

  async function onSignOut() {
    await insforge.auth.signOut()
    setUser(null)
    setRoles(null)
    setMembers([])
    setQueue({ status: 'loading' })
    setEnquiries({ status: 'loading' })
    setJobs({ status: 'loading' })
  }

  if (user === undefined) {
    return <div className="mx-auto max-w-xl px-4 py-8 text-navy-100">Loading…</div>
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-sm px-4 py-8">
        <h1 className="text-2xl font-extrabold text-white">Club admin sign-in</h1>
        <p className="mt-1 text-sm text-navy-100">Bulldogs OS staff accounts only.</p>
        <form onSubmit={onSignIn} className="mt-6 space-y-4 rounded-xl bg-white p-5 shadow">
          {authError && (
            <div role="alert" className="rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
              {authError}
            </div>
          )}
          <div>
            <label htmlFor="admin-email" className="block text-sm font-semibold text-navy-800">
              Email
            </label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="block text-sm font-semibold text-navy-800">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-navy-100 px-3 py-2 text-navy-900"
            />
          </div>
          <button
            type="submit"
            disabled={signingIn}
            className="w-full rounded-xl bg-navy-800 px-6 py-3 font-bold text-white disabled:opacity-60"
          >
            {signingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-extrabold text-white">Admin dashboard</h1>
        <button
          type="button"
          onClick={onSignOut}
          className="rounded-lg border border-navy-100 px-3 py-1 text-sm text-navy-100"
        >
          Sign out ({user.email})
        </button>
      </div>

      {rolesError && (
        <div role="alert" className="mt-4 rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
          Could not load your club roles: {rolesError}
        </div>
      )}

      {roles !== null && roles.length === 0 && !rolesError && (
        <div className="mt-4 rounded-xl bg-white p-5 text-navy-800" role="alert">
          <p className="font-semibold">This account has no club role.</p>
          <p className="mt-1 text-sm">
            Ask a club administrator to grant you a role (admin, coordinator, volunteer, coach or
            calendar_editor). Signed in as {user.email}.
          </p>
        </div>
      )}

      {roles !== null && roles.length > 0 && (
        <>
          <p className="mt-2 text-sm text-navy-100">
            Roles: {roles.map((r) => r.roles?.name ?? r.role_id).join(', ')}
          </p>

          <div className="mt-6 space-y-8">
            <Panel title="Action queue" state={queue}>
              {(rows) => (
                <table className="min-w-full text-left text-sm text-navy-800">
                  <thead>
                    <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                      <th className="px-3 py-2">Task</th>
                      <th className="px-3 py-2">State</th>
                      <th className="px-3 py-2">Lead</th>
                      <th className="px-3 py-2">Due</th>
                      <th className="px-3 py-2">Enquired</th>
                      <th className="px-3 py-2">Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.task_id} className="border-b border-navy-100 last:border-0">
                        <td className="px-3 py-2 font-medium">
                          {row.task_type}
                          {(row.overdue || isOverdue(row.due_at)) && (
                            <span className="ml-2 rounded bg-burgundy-700 px-1.5 py-0.5 text-xs font-bold text-white">
                              overdue
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{row.task_state}</td>
                        <td className="px-3 py-2">
                          {row.first_name} {row.last_name ?? ''}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(row.due_at)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(row.enquired_at)}</td>
                        <td className="px-3 py-2">{ownerName(row.owner_id, members)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Enquiries" state={enquiries}>
              {(rows) => (
                <table className="min-w-full text-left text-sm text-navy-800">
                  <thead>
                    <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                      <th className="px-3 py-2">Prospect</th>
                      <th className="px-3 py-2">Stage</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Enquired</th>
                      <th className="px-3 py-2">Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const person = toOne(row.person)
                      const chip = stageChip(row.stage)
                      return (
                        <tr key={row.id} className="border-b border-navy-100 last:border-0">
                          <td className="px-3 py-2">
                            {person ? (
                              <>
                                <span className="font-medium">
                                  {person.first_name} {person.last_name ?? ''}
                                </span>
                                <span className="block text-xs text-navy-600">{person.email}</span>
                              </>
                            ) : (
                              <span className="text-navy-600">Unknown</span>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <span className={chip.className}>{chip.label}</span>
                          </td>
                          <td className="px-3 py-2">{row.utm_source ?? '—'}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(row.created_at)}</td>
                          <td className="px-3 py-2">{ownerName(row.assigned_to, members)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Notification jobs" state={jobs}>
              {(rows) => (
                <table className="min-w-full text-left text-sm text-navy-800">
                  <thead>
                    <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">To</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Attempts</th>
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const chip = notificationStatusChip(row.status)
                      return (
                        <tr key={row.id} className="border-b border-navy-100 last:border-0">
                          <td className="px-3 py-2 font-medium">{row.type}</td>
                          <td className="px-3 py-2">{row.to_email}</td>
                          <td className="px-3 py-2">
                            <span className={chip.className}>{chip.label}</span>
                          </td>
                          <td className="px-3 py-2">{row.attempts}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(row.created_at)}</td>
                          <td className="px-3 py-2 max-w-52 truncate text-burgundy-700" title={row.last_error ?? ''}>
                            {row.last_error ?? '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

/** Panel shell giving every dashboard section the same loading/empty/error states
 * (plan §11 definition of done). */
function Panel<T>({ title, state, children }: { title: string; state: PanelState<T>; children: (rows: T[]) => ReactNode }) {
  return (
    <section className="overflow-x-auto rounded-xl bg-white shadow">
      <h2 className="border-b border-navy-100 px-4 py-3 text-lg font-extrabold text-navy-800">{title}</h2>
      {state.status === 'loading' && <p className="px-4 py-4 text-sm text-navy-600">Loading {title.toLowerCase()}…</p>}
      {state.status === 'error' && (
        <div role="alert" className="m-4 rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
          Could not load {title.toLowerCase()}: {state.error}
        </div>
      )}
      {state.status === 'done' && state.rows.length === 0 && (
        <p className="px-4 py-4 text-sm text-navy-600">Nothing here right now.</p>
      )}
      {state.status === 'done' && state.rows.length > 0 && children(state.rows)}
    </section>
  )
}

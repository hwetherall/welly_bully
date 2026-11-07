import { useEffect, useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { insforge } from '../lib/insforge'
import { formatTimestamp } from '../lib/format'
import type { ActionQueueRow } from '../lib/types'

export const Route = createFileRoute('/admin')({
  component: AdminPage,
})

type User = { id: string; email?: string }

type RoleRow = { role_id: number; roles: { name: string } | null }

type QueueState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'done'; rows: ActionQueueRow[] }

// Admin shell (Sprint 0/1): InsForge auth sign-in, role check via user_roles,
// then the action queue (plan P0.6 placeholder dashboard).
function AdminPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined) // undefined = checking session
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)

  const [roles, setRoles] = useState<RoleRow[] | null>(null)
  const [rolesError, setRolesError] = useState<string | null>(null)
  const [queue, setQueue] = useState<QueueState>({ status: 'loading' })

  useEffect(() => {
    void insforge.auth.getCurrentUser().then(({ data }) => setUser(data?.user ?? null))
  }, [])

  // Once we have a session, load club roles, then the action queue.
  useEffect(() => {
    if (!user) return
    let cancelled = false

    async function load() {
      setRoles(null)
      setRolesError(null)
      setQueue({ status: 'loading' })

      const { data, error } = await insforge.database
        .from('user_roles')
        .select('role_id, roles(name)')
        .eq('user_id', user!.id)
      if (cancelled) return
      if (error) {
        setRolesError(error.message)
        return
      }
      // PostgREST types the to-one `roles` embed as an array; normalize to a single object.
      const roleRows: RoleRow[] = ((data ?? []) as unknown[]).map((r) => {
        const row = r as { role_id: number; roles: { name: string } | { name: string }[] | null }
        return { role_id: row.role_id, roles: Array.isArray(row.roles) ? row.roles[0] ?? null : row.roles }
      })
      setRoles(roleRows)
      if (roleRows.length === 0) return // not a club account — no queue fetch

      const { data: queueRows, error: queueError } = await insforge.database
        .from('action_queue')
        .select('*')
        .limit(50)
      if (cancelled) return
      setQueue(
        queueError
          ? { status: 'error', error: queueError.message }
          : { status: 'done', rows: (queueRows ?? []) as ActionQueueRow[] }
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
    setQueue({ status: 'loading' })
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
        <h1 className="text-2xl font-extrabold text-white">Action queue</h1>
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
          {queue.status === 'loading' && <p className="mt-6 text-navy-100">Loading action queue…</p>}
          {queue.status === 'error' && (
            <div role="alert" className="mt-6 rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
              Could not load the action queue: {queue.error}
            </div>
          )}
          {queue.status === 'done' && queue.rows.length === 0 && (
            <p className="mt-6 rounded-xl bg-navy-800 p-5 text-navy-100">
              Nothing in the queue right now — no open or attempted tasks. 🎉
            </p>
          )}
          {queue.status === 'done' && queue.rows.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-xl bg-white shadow">
              <table className="min-w-full text-left text-sm text-navy-800">
                <thead>
                  <tr className="border-b border-navy-100 text-xs uppercase tracking-wide text-navy-600">
                    <th className="px-3 py-2">Task</th>
                    <th className="px-3 py-2">State</th>
                    <th className="px-3 py-2">Lead</th>
                    <th className="px-3 py-2">Due</th>
                    <th className="px-3 py-2">Enquired</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.rows.map((row) => (
                    <tr key={row.task_id} className="border-b border-navy-100 last:border-0">
                      <td className="px-3 py-2 font-medium">
                        {row.task_type}
                        {row.overdue && (
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

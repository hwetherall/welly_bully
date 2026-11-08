import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Outlet } from '@tanstack/react-router'
import { ClubAuthProvider, useClubAuth } from '../hooks/useClubAuth'

/** Shared chrome for the /admin/* routes (Sprint 2): auth gate + header nav.
 * Rendered once by the /admin layout route; children render into <Outlet />. */

export function AdminLayout() {
  return (
    <ClubAuthProvider>
      <AdminShell />
    </ClubAuthProvider>
  )
}

function AdminShell() {
  const { user, roleNames, rolesError, isStaff, signOut } = useClubAuth()

  if (user === undefined) {
    return <div className="mx-auto max-w-xl px-4 py-8 text-navy-100">Loading…</div>
  }

  if (!user) return <SignInCard />

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold text-white">Bulldogs OS admin</h1>
        <button
          type="button"
          onClick={() => void signOut()}
          className="rounded-lg border border-navy-100 px-3 py-1 text-sm text-navy-100"
        >
          Sign out ({user.email})
        </button>
      </div>

      <nav aria-label="Admin sections" className="mt-4 flex flex-wrap gap-2 text-sm font-semibold">
        <NavLink to="/admin" exact>
          Overview
        </NavLink>
        <NavLink to="/admin/leads">Leads</NavLink>
        <NavLink to="/admin/import">Import</NavLink>
        <NavLink to="/admin/returning">Returning</NavLink>
        <NavLink to="/admin/dashboard">Scoreboard</NavLink>
      </nav>

      {rolesError && (
        <div role="alert" className="mt-4 rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
          Could not load your club roles: {rolesError}
        </div>
      )}

      {!rolesError && !isStaff && (
        <div className="mt-4 rounded-xl bg-white p-5 text-navy-800" role="alert">
          <p className="font-semibold">This account has no club role.</p>
          <p className="mt-1 text-sm">
            Ask a club administrator to grant you a role (admin, coordinator, volunteer, coach or
            calendar_editor). Signed in as {user.email}.
          </p>
        </div>
      )}

      {isStaff && (
        <>
          <p className="mt-3 text-sm text-navy-100">Roles: {roleNames.join(', ')}</p>
          <div className="mt-4">
            <Outlet />
          </div>
        </>
      )}
    </div>
  )
}

function NavLink({
  to,
  exact,
  children,
}: {
  to: '/admin' | '/admin/leads' | '/admin/import' | '/admin/returning' | '/admin/dashboard'
  exact?: boolean
  children: ReactNode
}) {
  return (
    <Link
      to={to}
      activeOptions={exact ? { exact: true } : undefined}
      className="rounded-lg border border-navy-100 px-3 py-1.5 text-navy-100 hover:bg-navy-700"
      activeProps={{ className: '!bg-gold-500 !text-navy-900 !border-gold-500 font-bold' }}
    >
      {children}
    </Link>
  )
}

/** Staff sign-in card (email/password via InsForge auth). Accessible form: labels + alert. */
export function SignInCard() {
  const { signIn } = useClubAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setAuthError(null)
    setSigningIn(true)
    try {
      const err = await signIn(email, password)
      if (err) setAuthError(err)
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-8">
      <h1 className="text-2xl font-extrabold text-white">Club admin sign-in</h1>
      <p className="mt-1 text-sm text-navy-100">Bulldogs OS staff accounts only.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-xl bg-white p-5 shadow">
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

export type PanelState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'done'; rows: T }

/** Panel shell giving every admin section the same loading/empty/error states
 * (plan §11 definition of done). */
export function Panel<T>({
  title,
  state,
  empty = 'Nothing here right now.',
  children,
}: {
  title: string
  state: PanelState<T[]>
  empty?: string
  children: (rows: T[]) => ReactNode
}) {
  return (
    <section className="overflow-x-auto rounded-xl bg-white shadow">
      <h2 className="border-b border-navy-100 px-4 py-3 text-lg font-extrabold text-navy-800">{title}</h2>
      {state.status === 'loading' && <p className="px-4 py-4 text-sm text-navy-600">Loading {title.toLowerCase()}…</p>}
      {state.status === 'error' && (
        <div role="alert" className="m-4 rounded-lg bg-burgundy-100 p-3 text-sm font-medium text-burgundy-800">
          Could not load {title.toLowerCase()}: {state.error}
        </div>
      )}
      {state.status === 'done' && state.rows.length === 0 && <p className="px-4 py-4 text-sm text-navy-600">{empty}</p>}
      {state.status === 'done' && state.rows.length > 0 && children(state.rows)}
    </section>
  )
}

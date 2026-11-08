import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { insforge } from '../lib/insforge'
import { toOne } from '../lib/admin'
import type { ClubMember } from '../lib/types'

/** Minimal shape of an InsForge auth user as used by the admin shell. */
export interface ClubUser {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  profile?: { name?: string } | null
}

interface ClubAuthContextValue {
  /** undefined = session check still running, null = signed out */
  user: ClubUser | null | undefined
  roleNames: string[]
  rolesError: string | null
  members: ClubMember[]
  isStaff: boolean
  /** Sign in with email/password. Returns the error message, or null on success. */
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const ClubAuthContext = createContext<ClubAuthContextValue | null>(null)

type RoleRow = { role_id: number; roles: { name: string } | { name: string }[] | null }

/**
 * Shared admin-shell session state: current user, club roles (user_roles join roles),
 * and the club_members directory. On sign-in with a club role, registers the user in
 * club_members via rpc upsert_my_club_member (Sprint 2 follow-up — direct upserts are
 * blocked by RLS; the RPC is the sanctioned path). Failure is non-fatal: seeds already
 * cover the dev users, and the directory load still runs.
 */
export function ClubAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ClubUser | null | undefined>(undefined)
  const [roleNames, setRoleNames] = useState<string[]>([])
  const [rolesError, setRolesError] = useState<string | null>(null)
  const [members, setMembers] = useState<ClubMember[]>([])

  useEffect(() => {
    let cancelled = false
    insforge.auth
      .getCurrentUser()
      .then(({ data }) => {
        if (!cancelled) setUser((data?.user ?? null) as ClubUser | null)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setRoleNames([])
      setRolesError(null)
      setMembers([])
      return
    }
    let cancelled = false

    async function load() {
      setRolesError(null)
      const { data, error } = await insforge.database
        .from('user_roles')
        .select('role_id, roles(name)')
        .eq('user_id', user!.id)
      if (cancelled) return
      if (error) {
        setRolesError(error.message)
        return
      }
      const names = ((data ?? []) as RoleRow[])
        .map((r) => toOne(r.roles)?.name)
        .filter((n): n is string => Boolean(n))
      setRoleNames(names)
      if (names.length === 0) return // not a club account — nothing else to load

      // Sprint 2: register in club_members via RPC (replaces the direct upsert attempt
      // from Sprint 1, which RLS denied). Graceful on failure.
      const { error: rpcError } = await insforge.database.rpc('upsert_my_club_member')
      if (rpcError) {
        console.warn('[admin] upsert_my_club_member failed (non-fatal):', rpcError.message)
      }

      const { data: memberRows, error: membersError } = await insforge.database
        .from('club_members')
        .select('id, email, full_name')
      if (!cancelled && !membersError) setMembers((memberRows ?? []) as ClubMember[])
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [user])

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await insforge.auth.signInWithPassword({ email, password })
    if (error) return error.message
    setUser((data?.user ?? null) as ClubUser | null)
    return null
  }, [])

  const signOut = useCallback(async () => {
    await insforge.auth.signOut()
    setUser(null)
  }, [])

  const value = useMemo<ClubAuthContextValue>(
    () => ({
      user,
      roleNames,
      rolesError,
      members,
      isStaff: roleNames.length > 0,
      signIn,
      signOut,
    }),
    [user, roleNames, rolesError, members, signIn, signOut]
  )

  return <ClubAuthContext.Provider value={value}>{children}</ClubAuthContext.Provider>
}

export function useClubAuth(): ClubAuthContextValue {
  const ctx = useContext(ClubAuthContext)
  if (!ctx) throw new Error('useClubAuth must be used inside ClubAuthProvider')
  return ctx
}

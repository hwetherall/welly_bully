// Pure helpers for the /admin dashboard (plan P0.4/P0.6, Sprint 1 acceptance:
// "a test prospect appears in admin, has one owner and one correct deadline;
// failed email delivery remains visible").
// UI-free on purpose so vitest can cover them — see src/lib/__tests__/admin.test.ts.

/** Tailwind chip: label + classes, built from the club palette (tailwind.config.js)
 * plus Tailwind's default amber/red/green for status semantics. */
export interface Chip {
  label: string
  className: string
}

const CHIP_BASE = 'inline-block rounded px-1.5 py-0.5 text-xs font-bold whitespace-nowrap'

/**
 * Status chip for a notification_jobs row (migration: status enum is
 * queued/sending/sent/failed/cancelled, plus 'dry_run' added in Sprint 1).
 * dry_run = amber, failed = red, so delivery problems stay visible (WF-01.7).
 */
export function notificationStatusChip(status: string): Chip {
  switch (status) {
    case 'queued':
      return { label: 'queued', className: `${CHIP_BASE} bg-navy-100 text-navy-800` }
    case 'sending':
      return { label: 'sending', className: `${CHIP_BASE} bg-navy-100 text-navy-800` }
    case 'sent':
      return { label: 'sent', className: `${CHIP_BASE} bg-green-100 text-green-800` }
    case 'dry_run':
      return { label: 'dry run', className: `${CHIP_BASE} bg-amber-100 text-amber-800` }
    case 'failed':
      return { label: 'failed', className: `${CHIP_BASE} bg-red-100 text-red-800` }
    case 'cancelled':
      return { label: 'cancelled', className: `${CHIP_BASE} bg-gray-100 text-gray-700` }
    default:
      return { label: status, className: `${CHIP_BASE} bg-gray-100 text-gray-700` }
  }
}

/** Stage badge for an enquiries row (enquiry_stage enum, plan §6). */
export function stageChip(stage: string): Chip {
  switch (stage) {
    case 'new':
      return { label: 'new', className: `${CHIP_BASE} bg-gold-300 text-navy-900` }
    case 'assigned':
      return { label: 'assigned', className: `${CHIP_BASE} bg-navy-100 text-navy-800` }
    case 'attempted':
    case 'contacted':
      return { label: stage, className: `${CHIP_BASE} bg-blue-100 text-blue-800` }
    case 'training_planned':
    case 'attended':
    case 'active':
      return { label: stage, className: `${CHIP_BASE} bg-green-100 text-green-800` }
    case 'deferred':
    case 'dormant':
      return { label: stage, className: `${CHIP_BASE} bg-amber-100 text-amber-800` }
    case 'not_interested':
    case 'archived':
      return { label: stage, className: `${CHIP_BASE} bg-gray-100 text-gray-700` }
    default:
      return { label: stage, className: `${CHIP_BASE} bg-gray-100 text-gray-700` }
  }
}

/** Normalize a PostgREST to-one embed (`person:people(...)`, `roles(...)`),
 * which may arrive as an object or a single-element array. */
export function toOne<T>(embed: T | T[] | null | undefined): T | null {
  if (embed == null) return null
  return Array.isArray(embed) ? embed[0] ?? null : embed
}

/** Minimal shape of a club_members row used to resolve owner names. */
export interface ClubMemberLike {
  id: string
  email: string
  full_name: string | null
}

/** Resolve a task/enquiry owner UUID to a display name via the club_members
 * directory (RLS lets any club user read it — see migration 2). */
export function ownerName(ownerId: string | null | undefined, members: ClubMemberLike[]): string {
  if (!ownerId) return 'Unassigned'
  const member = members.find((m) => m.id === ownerId)
  if (!member) return 'Unknown owner'
  return member.full_name?.trim() || member.email || 'Unknown owner'
}

/** Minimal shape of an InsForge auth user as used here. The SDK exposes both
 * `user_metadata` (GoTrue-style) and `metadata`; accept either. */
export interface AuthUserLike {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  profile?: { name?: string } | null
}

/** Display name for a staff sign-in: user_metadata.full_name, then profile.name,
 * then the email prefix. Used for the club_members upsert on admin sign-in. */
export function displayNameFromUser(user: AuthUserLike): string {
  const meta = (user.user_metadata ?? user.metadata ?? {}) as Record<string, unknown>
  const fullName = typeof meta.full_name === 'string' ? meta.full_name.trim() : ''
  if (fullName) return fullName
  const profileName = user.profile?.name?.trim() ?? ''
  if (profileName) return profileName
  const prefix = (user.email ?? '').split('@')[0] ?? ''
  return prefix.trim() || 'Club member'
}

/** P0.4: the initial call task is due 48 elapsed hours after the enquiry was
 * received (submit_enquiry RPC uses NOW() + INTERVAL '48 hours'). */
export const INITIAL_CALL_DUE_MS = 48 * 60 * 60 * 1000

export function initialCallDueAt(enquiredAt: string | Date): Date {
  const base = enquiredAt instanceof Date ? enquiredAt : new Date(enquiredAt)
  // relative to receipt — mirrors the RPC's NOW() + INTERVAL '48 hours' exactly
  return new Date(base.getTime() + INITIAL_CALL_DUE_MS)
}

/** True when a due timestamp is already past (view also derives `overdue`, but
 * the UI recomputes so the badge stays correct while the page is open). */
export function isOverdue(dueAt: string | Date, now: Date = new Date()): boolean {
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt)
  return due.getTime() < now.getTime()
}

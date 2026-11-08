# HANDOFF.md — Bulldogs OS "builder unavailable for 30 days" runbook

> **STATUS: DRAFT — for club committee approval** (Sprint 5, `plan.md` §10: "The
> system remains useful if the builder is unavailable for 30 days").
>
> Audience: club committee members and nominated volunteers who are **not** the
> original builder. Everything here uses only a laptop, a browser, and the
> commands below. Related docs: [`plan.md`](./plan.md) (product source of truth),
> [`DECISIONS.md`](./DECISIONS.md) (architecture), [`TASKS.md`](./TASKS.md) (task
> board), [`PRIVACY.md`](./PRIVACY.md) (privacy notice draft), [`CHANGELOG.md`](./CHANGELOG.md).

---

## 1. Architecture map (what exists where)

| Piece | Where | What it is |
| --- | --- | --- |
| Repo | this repository (`bully-web`) | All source code + docs. Nothing here is secret. |
| Backend / database / auth / edge functions / AI gateway | **InsForge project `denver-bulldogs`** (region **us-west**, API base `https://z7nhzchw.us-west.insforge.app`) | Postgres + PostgREST + auth + edge functions. Linked to this repo at `.insforge/project.json` (gitignored). |
| Schema + permissions | `migrations/*.sql` in this repo | Plain Postgres (tables, RLS policies, RPC functions). Portable/exportable. |
| Seed data | `seeds/seed.mjs` (+ `seeds/seed_synthetic.sql`) | **Synthetic test data only** — no real personal data until committee approves an import. |
| Edge functions | `functions/` (`submit-enquiry`, `process-notification-jobs`, `events-ics`, …) | Serverless functions deployed to the InsForge project. |
| AI workflow | `agents/coordinator-digest/` | Weekly internal digest; **aggregate counts only, no player PII** (`DECISIONS.md` D5). |
| Frontend app | `app/` | Vite + React 18 + TypeScript + TanStack Router + Tailwind 3.4 SPA. Public site + `/admin/*` staff area in one app, separate auth boundaries (`DECISIONS.md` D2). |
| Backend tests | `tests/*.test.mjs` | Workflow tests run with Node against the live (dev) project. |

## 2. How to run things

Prereqs: Node 20+ (repo was built with Node 26), npm. The InsForge CLI runs via
`npx -y @insforge/cli ...` and reads credentials from `.insforge/project.json` at
the repo root (gitignored — see §3).

```bash
# Inspect the linked backend project
npx -y @insforge/cli current

# Apply schema migrations (idempotent-ish; safe on a fresh project)
npx -y @insforge/cli db migrations up --all

# Seed synthetic dev data (idempotent)
npm run seed            # = node seeds/seed.mjs

# Frontend
cd app
cp .env.example .env    # fill VITE_INSFORGE_URL / VITE_INSFORGE_ANON_KEY from ../.env.local
npm install
npm run dev             # local dev server

# Verify everything (build + unit tests + typecheck)
cd app && npm run build && npm test && npx tsc --noEmit

# All test suites
cd app && npm test                  # frontend unit tests (vitest)
node tests/wf01.test.mjs            # Sprint 1: enquiry -> assigned 48h task -> queued email
node tests/mailer.test.mjs          # notification queue worker (dry-run)
node tests/crm.test.mjs             # Sprint 2: CRM RPCs + permissions
node tests/import.test.mjs          # Sprint 3: roster import + returning players
node tests/calendar.test.mjs        # Sprint 4: events, .ics feed, attendance, notices
```

Public calendar feed (deployed): `https://z7nhzchw.us-west.insforge.app/functions/events-ics`

## 3. Credentials ownership (where keys live — never committed)

- **Never in git.** `.gitignore` excludes `.env`, `.env.local`, `.env*.local`,
  `.insforge/`. Do not paste keys into issues, chat, or docs.
- **Root `.env.local`** (repo root, gitignored): `INSFORGE_ANON_KEY`,
  `INSFORGE_API_KEY` (server-only scripts/tests), `VIBE_API_KEY` (Mistral),
  `OPENROUTER_API_KEY` (server-only). Used by `seeds/` and `tests/`.
- **`app/.env.local`**: `VITE_INSFORGE_URL` / `VITE_INSFORGE_ANON_KEY` (same values,
  Vite-prefixed; the anon key is public-by-design and scoped by RLS).
- **InsForge project secrets** (`INSFORGE_BASE_URL`, `API_KEY`, `ANON_KEY`): stored in
  the InsForge project secret manager, read by edge functions via `Deno.env` — never
  copied into function code (`DECISIONS.md` D9).
- **Who owns them:** the club committee treasurer/admin (currently Harry). The
  `.env.local` file and `.insforge/` login live on Harry's machine and must be
  handed to the second admin (§6) — e.g. via the club's password manager.
- **Rotation:** if a key may be leaked:
  `npx -y @insforge/cli secrets rotate api-key` (or `anon-key`). The new key prints
  **once** — capture it, then update `.env.local`, `app/.env.local`, and re-run
  seeds/tests. Old key keeps working during the grace window.

## 4. Dev users and roles (synthetic only)

`seeds/seed.mjs` creates 5 synthetic auth users, all with the dev password
`Bulldogs!Dev2026` (recorded in that file — synthetic accounts only, rotate/change
before any real deployment):

| Email | Role |
| --- | --- |
| `harry.admin@bulldogs-dev.test` | admin |
| `cara.coordinator@bulldogs-dev.test` | coordinator |
| `vic.volunteer@bulldogs-dev.test` | volunteer |
| `val.volunteer@bulldogs-dev.test` | volunteer |
| `coach@bulldogs-dev.test` | coach |

Roles live in the `roles` / `user_roles` tables (role_id 1 = admin, 2 = coordinator,
3 = volunteer, 4 = coach, 5 = calendar_editor).

## 5. Backups (InsForge)

```bash
npx -y @insforge/cli backups list                 # list backups
npx -y @insforge/cli backups latest               # most recent backup (+ download URL)
npx -y @insforge/cli backups create --name pre-launch-2026-11 --wait   # create now
npx -y @insforge/cli backups restore <backupId>   # RESTORE — overwrites current DB; confirm first!
```

Sprint 5 must include a **restore test**: create a backup, restore it into the dev
project (or a scratch project), confirm the app still builds/runs against it. Plan
§8 requires daily recoverable backups in production — verify the InsForge project's
backup schedule once live.

## 6. Two-admin rule

Plan §9 requires **at least two trusted administrators** with recovery access.
**Current state: only `harry.admin@bulldogs-dev.test` holds role_id=1 (admin).**

**Action for the committee: nominate a second admin**, then grant it (as an admin,
e.g. via `npx -y @insforge/cli db query` with the admin API key):

```sql
insert into user_roles (user_id, role_id, granted_by)
values ('<new-admin-user-id>', 1, '<harry-admin-user-id>');
```

Also hand over: the `.env.local` secrets and the InsForge project login (§3), and
record both admins here: _TBD — committee to nominate._

## 7. Weekly support checklist (5 minutes, any admin)

1. **Drain the notification queue** (emails are queued rows; dry-run unless a real
   send was approved):
   `npx -y @insforge/cli functions invoke process-notification-jobs --method POST`
   Check `notification_jobs` for stuck `queued`/`failed` rows.
2. **Review the action queue** in the app: `/admin` → unassigned leads and overdue
   `make_initial_call` tasks must be assigned/reassigned — never silently dropped
   (plan P0.4). `/admin/dashboard` shows the 48-hour SLA.
3. **Run the weekly digest** (internal, aggregate-only):
   `npx -y @insforge/cli functions invoke weekly-digest --method POST`
   Review the draft in `digest_runs` before sharing with the committee.
4. Check `/admin/events` for material changes flagged on the public banner; confirm
   the `.ics` feed reflects them.
5. Check InsForge dashboard for errors/uptime; run `npx -y @insforge/cli backups latest`
   to confirm backups are being taken.

## 8. Rollback plan

- **Frontend:** redeploy the previous known-good build:
  `npx -y @insforge/cli deployments deploy app/dist` (after `cd app && npm run build`)
  from the last good commit; or repoint the custom domain to the previous deployment
  via `npx -y @insforge/cli domains ...` (see the `insforge-cli` skill,
  `references/deployments/`). Keep the last good git commit hash in `CHANGELOG.md`.
- **Backend schema:** migrations are additive; if a migration breaks something,
  restore the database from the latest backup (§5) — **this loses data written since
  the backup**, so announce it first. Prefer a fix-forward migration.
- **Edge functions:** redeploy the previous function version:
  `npx -y @insforge/cli functions deploy <slug> --file functions/<file>` from the
  last good commit.
- **Domain:** the club domain should only be repointed by committee approval
  (plan §13). Until launch, everything runs on the InsForge-provided URL.

## 9. Escalation

1. Volunteer/coordinator on duty (action queue owner).
2. Club admins (currently Harry only — fix per §6).
3. InsForge platform status/support via the InsForge console; the `insforge-debug`
   skill (installed for supported agents) covers common failure diagnosis.

---

*Draft — committee to fill the TBD data-controller and second-admin names, then
approve. Maintained alongside `TASKS.md`.*

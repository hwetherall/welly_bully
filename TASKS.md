# TASKS.md — Bulldogs OS task board

Source of truth for what's done / doing / next. Mirrors `plan.md` §10 sprints. Update after every vertical slice.

## Sprint 0 — Discover / prepare (Scaffolding) — DONE 2026-11-07
- [x] Inspect repo, plan, `pm/` agents, toolchain (Node 26, bun, Python 3.14; InsForge CLI authenticated)
- [x] Create InsForge project `denver-bulldogs` (us-west), link at repo root; secrets INSFORGE_BASE_URL/API_KEY/ANON_KEY set
- [x] Write `DECISIONS.md`, `TASKS.md`, `plan.md`, README run notes, `.gitignore`, `insforge.toml` (dev: email verification off)
- [x] Migration `migrations/20261107211910_bulldogs-core-schema.sql`: full minimum data model (plan §6) + RLS + SECURITY DEFINER role helpers + `action_queue` view + RPC `submit_enquiry` (atomic WF-01 write, idempotent)
- [x] Seed synthetic data (`seeds/seed.mjs`, idempotent) + 5 synthetic auth users with roles (admin/coordinator/volunteer×2/coach)
- [x] Frontend scaffold `app/` (Vite + React 18 + TanStack Router + Tailwind 3.4): `/`, `/signup`, `/thanks`, `/admin` shell — build + typecheck + 9/9 unit tests pass
- [x] Edge function `functions/submit-enquiry.ts` deployed `active`; `tests/wf01.test.mjs` — 13/13 PASS (happy path, idempotency, validation 400s, rate-limit 429)
- [x] Agent scaffold `agents/coordinator-digest/` — `weekly-digest` deployed `active`, invoked with Mistral model via backend gateway; digest_runs row `status: draft`, aggregate-only input_stats (no PII); schedule command documented but NOT run (needs approval)
- [x] Verified end-to-end: migrations apply clean; RPC smoke test (assigned + 48h task + 1 queued job + idempotent duplicate); app builds; tests pass

**Sprint 0 exit (plan §10):** ✅ repo + environments work; synthetic test data + role access established; decisions logged; no live personal data, no real emails, no deployment.

## Sprint 1 — First enquiry: visitor → assigned task (P0.1–P0.4)
- [ ] P0.1 landing page live-wired to published events (next session card, map link, CTA)
- [ ] P0.2 signup form → `submit-enquiry` (validation, consent, dedupe, UTM capture)
- [ ] P0.3 confirmation email via `notification_jobs` + mailer function (approval-gated)
- [ ] P0.4 volunteer rotation assignment + 48h `make_initial_call` task + internal alert
- [ ] Admin: enquiry appears with owner + deadline; basic admin view
- [ ] E2E happy-path test: mobile-width submit → exactly one queued email → one owner → correct due date

## Sprint 2 — Volunteer workflow + scoreboard (P0.5–P0.6)
- [ ] CRM list/profile, interactions, stage changes, action queue, coordinator dashboard, audit trail

## Sprint 3 — Returning players (P0.7)
- [ ] CSV import preview/confirm, reconciliation, internal re-engagement tasks only

## Sprint 4 — Calendar + attendance (P1)
- [ ] Event CRUD + change tracking, public `.ics` feed, change banner + manual approved notices, attendance capture

## Sprint 5 — Production hardening + handover
- [ ] Restore test, monitoring, privacy/deletion checks, CSV export, docs, 2-admin handover, launch on club domain (approval-gated)

## Later (V2, not now)
Payments/merch (Stripe via InsForge), member portal, automated outreach (explicitly out of scope per plan §4).

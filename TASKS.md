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

## Sprint 1 — First enquiry: visitor → assigned task (P0.1–P0.4) — DONE 2026-11-07
- [x] P0.1 landing page live-wired to published events (next session card, map link, CTA) — app/ route `/`, verified against live DB
- [x] P0.2 signup form → `submit-enquiry` (validation, consent, dedupe, UTM capture) — 15/15 tests incl. anon browser-path invoke
- [x] P0.3 confirmation email via `notification_jobs` + mailer `process-notification-jobs` (dry-run default `EMAIL_DRY_RUN=true`; real send approval-gated) — 7/7 mailer tests
- [x] P0.4 volunteer rotation + 48h `make_initial_call` task + `internal_alert` job to assignee (club_members lookup) — asserted in tests
- [x] Admin: action queue + enquiries + notification jobs panels with owner/deadline/status chips (app/src/routes/admin.tsx, lib/admin.ts; 24/24 app tests)
- [x] E2E happy-path test: submit → 1 confirmation job + 1 alert → one owner → due +48h (delta 0.0s) → idempotent resubmit; live smoke: action_queue row + both jobs dry_run
- [x] Migration 2: `internal_alert`/`dry_run` enums + `club_members` table + seeded

**Sprint 1 acceptance (plan §10):** ✅ test prospect submits (anon, browser path), sees confirmation data, exactly one confirmation email job queued (dry-run), appears in admin action queue with one owner and due = created+48h; duplicate submit and mailer failure don't corrupt records. Known follow-up: club_members self-upsert is admin-only by RLS (5 dev users seeded; add RPC path in Sprint 2 if needed).

## Sprint 2 — Volunteer workflow + scoreboard (P0.5–P0.6) — DONE 2026-11-08
- [x] Migration 3: CRM RPCs with in-RPC permission checks + audit: set_enquiry_stage, log_interaction, complete_task, reassign_enquiry, recruitment_stats, upsert_my_club_member
- [x] Migration 4: fix recruitment_stats ambiguity + auth.users metadata column
- [x] Migration 5: audit_events readable by all staff (timeline for volunteers on own leads)
- [x] tests/crm.test.mjs — 10/10 PASS with real signed-in users (assignee vs coordinator vs coach permissions, reassign, idempotent complete, stats staff-only, club_members upsert)
- [x] CRM UI in app/: `/admin` overview, `/admin/leads` (filters: owner/stage/source/overdue), `/admin/leads/$id` (person card, stage editor, task completion, log-interaction form, reassign for coordinator/admin, milestone quick-log, merged activity timeline), `/admin/dashboard` (recruitment_stats: 48h SLA %, median hours to first attempt, overdue/unassigned, conversion; 7/30/90d windows); sign-in calls upsert_my_club_member
- [x] app: build clean, tsc strict clean, 50/50 unit tests; backend suites re-run green (wf01 15/15, mailer 7/7, crm 10/10)

**Sprint 2 acceptance (plan §10):** ✅ find/call/log/update an assigned lead via audited RPCs in seconds; coordinator sees overdue + unassigned and can reassign; all actions attributable (audit_events actor+timestamp). Live dev-server click-through not possible in agent sandbox (server spawn blocked) — verified via build + route tree + tests; manual `cd app && npm run dev` recommended.

## Sprint 3 — Returning players (P0.7) — DONE 2026-11-08
- [x] Migration 6: `people.import_id` + `data_imports.rows` provenance, `returning_player_candidates` view, RPCs create_roster_import (preview, no writes) / confirm_roster_import (consent stays FALSE) / create_reengagement_review (internal task, idempotent)
- [x] tests/import.test.mjs — 19/19 PASS, re-runnable (preview counts, no writes on preview, role denials, consent=false, provenance, idempotent confirm, view flags 2026-only players, review task flow, zero auto-outreach)
- [x] UI in app/: `/admin/import` (CSV upload/drag-drop, hand-rolled parser, sample CSV, season select, preview badges, coordinator-gated confirm, past imports) + `/admin/returning` (candidates table, create-review-task with owner select, already_exists handling); nav links added
- [x] app: build clean, tsc strict clean, 84/84 unit tests; backend suites green (import 19/19 ×2 runs, crm 10/10, wf01 15/15, mailer 7/7)

**Sprint 3 acceptance (plan §10):** ✅ import identifies unreturned players without duplicate profiles (email match, in-file dup + invalid flagged) and generates INTERNAL review tasks only — tests assert zero notification_jobs from imports and consent_contact=false on imported people. Live click-through needs a manual `npm run dev` pass (server spawn blocked in sandbox).

## Sprint 4 — Calendar + attendance (P1) — DONE 2026-11-08
- [x] Migration 7: events.material_change + revision tracking; RPCs upsert_event (calendar_editor/admin, audit before/after, material change detection), mark_attendance (coach+; derives first/second_training milestones in the event's season), queue_event_update_notice (coordinator/admin; consented participants only, idempotent per event+revision)
- [x] functions/events-ics.ts deployed active: public feed (published+cancelled, stable UID, SEQUENCE=revision, STATUS:CANCELLED, VTIMEZONE America/Denver) + ?uid= single-event attachment; smoke-tested 200 text/calendar, drafts/private excluded
- [x] tests/calendar.test.mjs — 19/19 PASS ×3 consecutive runs (draft hidden from anon, publish visible, role denials, revision/material_change/audit, ICS feed incl. cancellation + single-uid, attendance + derived milestones + season, notice queue consent-scoped + idempotent)
- [x] UI: public change banner (dismissible) + upcoming sessions list + per-event .ics "Add to calendar" + feed subscribe link; /admin/events CRUD form with Denver-tz datetime handling + change-notice queue panel; /admin/attendance with person search, walk-in/consent, derived-milestone feedback; 107/107 app tests, strict tsc + build clean

**Sprint 4 acceptance (plan §10):** ✅ authorized edit → revision bump + material_change + audit, visible in feed immediately with stable UID and explicit cancellation; change notice is admin-triggered, consent-scoped, queued (dry-run) and logged; attendance links person↔event↔season and derives first/second training milestones. Google/Outlook subscription refresh-delay caveat documented in plan P1.2 (feed is always current; subscribers refresh eventually). Live click-through still needs a manual `npm run dev` pass.

## Sprint 5 — Production hardening + handover
- [ ] Restore test, monitoring, privacy/deletion checks, CSV export, docs, 2-admin handover, launch on club domain (approval-gated)

## Later (V2, not now)
Payments/merch (Stripe via InsForge), member portal, automated outreach (explicitly out of scope per plan §4).

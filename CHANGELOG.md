# CHANGELOG.md — Bulldogs OS

Sprint history per `plan.md` §10. Commit hashes from `git log --oneline`.
Sprint 5 (production hardening + handover) is in progress — see `TASKS.md`.

## Sprint 0 — Discover / prepare (scaffolding) — DONE 2026-11-07
- `a63b992` Sprint 0: Bulldogs OS scaffolding on InsForge (schema+RLS+RPC, seed, app shell, submit-enquiry fn+tests, coordinator-digest agent)
- `72d56bd` Document key/env contract (DECISIONS.md D9) after adding Mistral + InsForge keys to .env.local
- `ef1affb` Plan added (plus initial commits `5c33d99`, `59cc311`)
- InsForge project `denver-bulldogs` (us-west) created/linked; core schema migration with RLS + `submit_enquiry` RPC; 5 synthetic dev users with roles; Vite+React+TS app shell (`/`, `/signup`, `/thanks`, `/admin`); 9/9 unit tests + 13/13 WF-01 tests green.

## Sprint 1 — First enquiry: visitor → assigned task (P0.1–P0.4) — DONE 2026-11-07
- `325e2ad` Sprint 1: enquiry → assigned 48h task → queued emails (dry-run mailer) + admin panels
- Landing page live-wired to published events; signup form → `submit-enquiry` edge function (validation, consent, dedupe, UTM); confirmation email via `notification_jobs` + dry-run mailer; volunteer rotation + 48h `make_initial_call` task + internal alert; admin action queue / enquiries / notification panels. 15/15 WF-01 + 7/7 mailer tests.

## Sprint 2 — Volunteer workflow + scoreboard (P0.5–P0.6) — DONE 2026-11-08
- `181592b` Sprint 2: volunteer CRM + coordinator scoreboard
- `d2d674b` Track the pm workflow notes and stop committing Cursor hook state (housekeeping)
- CRM RPCs with in-RPC permission checks + audit (stage, interactions, tasks, reassign, stats); `/admin/leads` + `/admin/leads/$id` + `/admin/dashboard` (48h SLA %, median time-to-first-attempt, conversion). 10/10 CRM tests; 50/50 app tests.

## Sprint 3 — Returning players (P0.7) — DONE 2026-11-08
- `92e1e3d` Sprint 3: returning-player reconciliation (CSV import preview/confirm + internal review tasks)
- CSV roster import with preview/confirm and provenance, consent stays FALSE on imports, `returning_player_candidates` view, internal-only re-engagement review tasks (zero automated outreach). `/admin/import` + `/admin/returning` UI. 19/19 import tests; 84/84 app tests.

## Sprint 4 — Calendar + attendance (P1) — DONE 2026-11-08
- `4e5b46b` Sprint 4: calendar with change tracking, public .ics feed, attendance-derived milestones, opted-in update notices
- `26c16e3` DECISIONS D10: Studio Apps research — paid PAYG/Enterprise entitlement only; InsForge stays V1 host
- Events CRUD with revision/material-change tracking + audit; public `.ics` feed (stable UID, America/Denver VTIMEZONE, cancellation semantics); public change banner + per-event "Add to calendar"; attendance capture deriving first/second-training milestones; admin-triggered, consent-scoped update notices (queued, dry-run). 19/19 calendar tests; 107/107 app tests.

## Sprint 5 — Production hardening + handover — IN PROGRESS
- Privacy notice draft (`PRIVACY.md`), handover runbook (`HANDOFF.md`), this changelog, accessibility pass in `app/` (skip link, focus-visible, reduced-motion, aria-live status regions, contrast audit). Remaining per `TASKS.md`: restore test, monitoring, CSV export verification, two-admin nomination, launch on club domain (approval-gated).
